// components/VoiceChat.tsx
import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";

// A dedicated component to handle remote audio playback
const RemoteAudio = ({ stream, isSilenced }: { stream: MediaStream; isSilenced: boolean }) => {
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.srcObject = stream;
            audioRef.current.muted = isSilenced;
        }
    }, [stream, isSilenced]);

    return <audio ref={audioRef} autoPlay playsInline />;
};

const iceServersConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const VoiceChat = forwardRef<any, any>(({ supabase, room, isMuted, setIsMuted, isSilenced, setIsSilenced }, ref) => {
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
    const [isCalling, setIsCalling] = useState(false);
    const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});
    const candidatesQueue = useRef<{ [key: string]: RTCIceCandidate[] }>({});
    const localUserId = useRef(localStorage.getItem("userId"));

    // Function to initialize WebRTC call
    const startCall = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: true,
                    echoCancellation: true,
                },
                video: false,
            });

            setLocalStream(stream);
            setIsCalling(true);

            // Get the current presence state from the correct, single presence channel
            const presenceState = supabase.channel("presence-tracker").presenceState();
            const usersInRoom = presenceState[room.id]
                ? presenceState[room.id]
                      .map((p: any) => ({ user_id: p.user_id }))
                      .filter((p: any) => p.user_id !== localUserId.current)
                : [];

            usersInRoom.forEach(async (otherUser: any) => {
                if (otherUser.user_id !== localUserId.current) {
                    const peerConnection = new RTCPeerConnection(iceServersConfig);
                    peerConnections.current[otherUser.user_id] = peerConnection;

                    stream.getTracks().forEach((track) => {
                        peerConnection.addTrack(track, stream);
                    });

                    peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
                        if (event.candidate) {
                            supabase
                                .from("signals")
                                .insert({
                                    room_id: room.id,
                                    sender_id: localUserId.current,
                                    receiver_id: otherUser.user_id,
                                    type: "ice-candidate",
                                    data: event.candidate,
                                })
                                .then(({ error }: any) => {
                                    if (error) console.error("Error sending ICE candidate:", error);
                                });
                        }
                    };

                    peerConnection.ontrack = (event: RTCTrackEvent) => {
                        const newRemoteStream = event.streams[0];
                        setRemoteStreams((prevStreams) => [...prevStreams, newRemoteStream]);
                    };

                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);

                    supabase
                        .from("signals")
                        .insert({
                            room_id: room.id,
                            sender_id: localUserId.current,
                            receiver_id: otherUser.user_id,
                            type: "offer",
                            data: peerConnection.localDescription,
                        })
                        .then(({ error }: any) => {
                            if (error) console.error("Error sending offer:", error);
                        });
                }
            });
        } catch (e) {
            console.error("Error starting call:", e);
        }
    };

    const endCall = () => {
        // Stop all local media tracks (e.g., the microphone)
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
        }

        // Close all peer connections
        Object.values(peerConnections.current).forEach((pc: any) => pc.close());

        // Reset all states related to the call
        setLocalStream(null);
        setRemoteStreams([]);
        setIsCalling(false);
        setIsMuted(false);
        setIsSilenced(false);
        peerConnections.current = {};
    };
    // Use useImperativeHandle to expose the endCall function to the parent
    useImperativeHandle(ref, () => ({
        endCall: endCall,
    }));

    const toggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach((track) => {
                track.enabled = !track.enabled;
            });
            setIsMuted(!isMuted);
        }
    };
    const toggleSilence = () => {
        setIsSilenced(!isSilenced);
    };

    // useEffect hooks for cleanup and signaling
    useEffect(() => {
        return () => {
            if (isCalling) {
                endCall();
            }
        };
    }, [isCalling]);

    useEffect(() => {
        // Only start listening for signals if a call is in progress
        if (!supabase || !isCalling) {
            return;
        }

        const signalSubscription = supabase
            .channel(`room_${room.id}_signals`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "signals",
                    filter: `room_id=eq.${room.id}`,
                },
                async (payload: any) => {
                    const signal = payload.new;

                    if (signal.receiver_id !== localUserId.current) {
                        return;
                    }

                    let peerConnection = peerConnections.current[signal.sender_id];

                    if (!peerConnection) {
                        peerConnection = new RTCPeerConnection(iceServersConfig);
                        peerConnections.current[signal.sender_id] = peerConnection;

                        if (localStream) {
                            localStream.getTracks().forEach((track) => {
                                peerConnection.addTrack(track, localStream);
                            });
                        }

                        peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
                            if (event.candidate) {
                                supabase
                                    .from("signals")
                                    .insert({
                                        room_id: room.id,
                                        sender_id: localUserId.current,
                                        receiver_id: signal.sender_id,
                                        type: "ice-candidate",
                                        data: event.candidate,
                                    })
                                    .then(({ error }: any) => {
                                        if (error) console.error("Error sending ICE candidate:", error);
                                    });
                            }
                        };

                        peerConnection.ontrack = (event: RTCTrackEvent) => {
                            const newRemoteStream = event.streams[0];
                            setRemoteStreams((prevStreams) => [...prevStreams, newRemoteStream]);
                        };
                    }

                    // Helper function to process queued ICE candidates
                    const processCandidatesQueue = async (pc: RTCPeerConnection, senderId: string) => {
                        const candidates = candidatesQueue.current[senderId];
                        if (candidates && candidates.length > 0) {
                            for (const candidate of candidates) {
                                try {
                                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                                } catch (e) {
                                    console.error("Error adding queued ICE candidate:", e);
                                }
                            }
                            candidatesQueue.current[senderId] = []; // Clear the queue
                        }
                    };

                    if (signal.type === "offer") {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));
                        // After setting the remote description, process any queued candidates
                        processCandidatesQueue(peerConnection, signal.sender_id);

                        const answer = await peerConnection.createAnswer();
                        await peerConnection.setLocalDescription(answer);

                        supabase
                            .from("signals")
                            .insert({
                                room_id: room.id,
                                sender_id: localUserId.current,
                                receiver_id: signal.sender_id,
                                type: "answer",
                                data: peerConnection.localDescription,
                            })
                            .then(({ error }: any) => {
                                if (error) console.error("Error sending answer:", error);
                            });
                    } else if (signal.type === "answer") {
                        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.data));
                        // After setting the remote description, process any queued candidates
                        processCandidatesQueue(peerConnection, signal.sender_id);
                    } else if (signal.type === "ice-candidate") {
                        if (peerConnection.remoteDescription) {
                            // Remote description is set, add the candidate immediately
                            try {
                                await peerConnection.addIceCandidate(new RTCIceCandidate(signal.data));
                            } catch (e) {
                                console.error("Error adding ICE candidate:", e);
                            }
                        } else {
                            // Remote description is not yet set, queue the candidate
                            if (!candidatesQueue.current[signal.sender_id]) {
                                candidatesQueue.current[signal.sender_id] = [];
                            }
                            candidatesQueue.current[signal.sender_id].push(signal.data);
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            signalSubscription.unsubscribe();
        };
    }, [supabase, localStream, room.id, isCalling]);

    return (
        <div className="min-w-40 ml-auto flex items-start justify-end gap-2">
            {isCalling && (
                <>
                    <button
                        onClick={toggleMute}
                        className="font-bold p-2 rounded-lg transition-colors duration-200 bg-n600 hover:bg-n500"
                    >
                        {isMuted ? (
                            <img className="w-8 h-8" src="mute.svg" alt="Mute Icon" />
                        ) : (
                            <img className="w-8 h-8" src="unmute.svg" alt="Unmute Icon" />
                        )}
                    </button>
                    <button
                        onClick={toggleSilence}
                        className="font-bold p-2 rounded-lg transition-colors duration-200 bg-n600 hover:bg-n500"
                    >
                        {isSilenced ? (
                            <img className="w-8 h-8" src="deafen.svg" alt="Deafen Icon" />
                        ) : (
                            <img className="w-8 h-8" src="undeafen.svg" alt="Undeafen Icon" />
                        )}
                    </button>
                </>
            )}
            <button
                onClick={isCalling ? endCall : startCall}
                className={`font-bold p-2 rounded-lg transition-colors duration-400 ${
                    isCalling ? "bg-red-600 hover:bg-red-700 text-white" : "bg-green-600 hover:bg-green-700 text-white"
                }`}
            >
                {isCalling ? (
                    <img className="w-8 h-8 rotate-out" src="end-call.svg" alt="End Call Icon" />
                ) : (
                    <img className="w-8 h-8 rotate-in" src="start-call.svg" alt="Start Call Icon" />
                )}
            </button>
            {/* Render remote audio streams here */}
            {remoteStreams.map((stream, index) => (
                <RemoteAudio key={index} stream={stream} isSilenced={isSilenced} />
            ))}
        </div>
    );
});

export default VoiceChat;
