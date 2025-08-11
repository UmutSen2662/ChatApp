import { useState, useEffect, useRef } from "react";

// A dedicated component to handle remote audio playback
const RemoteAudio = ({ stream, isSilenced }: { stream: MediaStream; isSilenced: boolean }) => {
    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.srcObject = stream;
            // The audio element's muted property is controlled by the isSilenced prop
            audioRef.current.muted = isSilenced;
        }
    }, [stream, isSilenced]);

    // The audio element is hidden, as we only need its sound output
    return <audio ref={audioRef} autoPlay playsInline />;
};

const ChatRoom = ({ supabase, room, user, onLeaveRoom }: any) => {
    // --- Message and UI states
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // --- WebRTC states and refs
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
    const [participants, setParticipants] = useState<any[]>([]);
    const [isCalling, setIsCalling] = useState(false);
    // New states for mute and silence functionality
    const [isMuted, setIsMuted] = useState(false);
    const [isSilenced, setIsSilenced] = useState(false);
    const peerConnections = useRef<{ [key: string]: RTCPeerConnection }>({});
    const candidatesQueue = useRef<{ [key: string]: RTCIceCandidate[] }>({}); // New ref to queue ICE candidates
    const localUserId = useRef(localStorage.getItem("userId"));

    // --- Function to fetch initial messages and set up real-time subscription
    useEffect(() => {
        const fetchMessages = async () => {
            if (!supabase) return;

            try {
                const { data, error } = await supabase
                    .from("messages")
                    .select("*")
                    .eq("room_id", room.id)
                    .order("created_at", { ascending: true })
                    .limit(50);
                if (error) throw error;
                setMessages(data || []);
            } catch (e: any) {
                console.error("Error fetching messages:", e.message);
            }
        };

        const subscribeToMessages = () => {
            const messageSubscription = supabase
                .channel(`room_${room.id}_messages`)
                .on(
                    "postgres_changes",
                    {
                        event: "INSERT",
                        schema: "public",
                        table: "messages",
                        filter: `room_id=eq.${room.id}`,
                    },
                    (payload: any) => {
                        setMessages((prevMessages) => [...prevMessages, payload.new]);
                    }
                )
                .subscribe();

            return () => {
                messageSubscription.unsubscribe();
            };
        };

        fetchMessages();
        const unsubscribe = subscribeToMessages();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [supabase, room.id]);

    // --- Auto-scroll to the bottom when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // --- Function to send a new message
    const handleSendMessage = async (e: any) => {
        e.preventDefault();
        if (newMessage.trim() === "") return;

        setIsSending(true);

        try {
            await supabase.from("messages").insert({
                room_id: room.id,
                user_id: localUserId.current,
                user_name: user.name,
                user_color: user.color,
                content: newMessage,
            });
            setNewMessage(""); // Clear the input field after successful send
        } catch (e: any) {
            console.error("Error sending message:", e.message);
        } finally {
            setIsSending(false);
        }
    };

    // --- WebRTC Logic starts here ---

    // Supabase Presence channel to track users in the room
    useEffect(() => {
        if (!supabase) return;

        // Use a new Supabase channel for presence
        const presenceChannel = supabase.channel(`room_${room.id}_presence`, {
            config: {
                presence: {
                    key: localUserId.current,
                },
            },
        });

        // Event listener for presence state changes
        presenceChannel.on("presence", { event: "sync" }, () => {
            const presenceState = presenceChannel.presenceState();
            const currentParticipants = Object.keys(presenceState)
                .map((key) => {
                    if (key !== localUserId.current) {
                        return {
                            id: key,
                            user_name: presenceState[key][0].user_name,
                            user_color: presenceState[key][0].user_color,
                        };
                    }
                    return null;
                })
                .filter(Boolean);
            setParticipants(currentParticipants);
            console.log("Participants in room:", currentParticipants);
        });

        // Subscribe to the presence channel
        presenceChannel.subscribe(async (status: string) => {
            if (status === "SUBSCRIBED") {
                // Let other users know we are here
                await presenceChannel.track({
                    user_id: localUserId.current,
                    user_name: user.name,
                    user_color: user.color,
                });
            }
        });

        return () => {
            // Unsubscribe from the presence channel on component unmount
            presenceChannel.unsubscribe();
        };
    }, [supabase, room.id, user.name, user.color]);

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
            setIsCalling(true); // Set calling state to true

            // Fetch a list of active participants from our new presence channel
            const presenceState = supabase.channel(`room_${room.id}_presence`).presenceState();
            const usersInRoom = Object.keys(presenceState).map((key) => ({ user_id: key }));

            usersInRoom.forEach(async (otherUser: any) => {
                if (otherUser.user_id !== localUserId.current) {
                    const peerConnection = new RTCPeerConnection();
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

    const handleLeaveRoom = () => {
        endCall();
        onLeaveRoom();
    };

    // Function to end the voice call and clean up resources
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
        setIsMuted(false); // Reset mute state
        setIsSilenced(false); // Reset silence state
        peerConnections.current = {};
    };

    // Function to toggle mute for the local microphone
    const toggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach((track) => {
                track.enabled = !track.enabled;
            });
            setIsMuted(!isMuted);
        }
    };

    // Function to toggle silence for all remote audio
    const toggleSilence = () => {
        setIsSilenced(!isSilenced);
    };

    // Use a single cleanup effect to handle disconnection on component unmount
    useEffect(() => {
        return () => {
            if (isCalling) {
                endCall();
            }
        };
    }, [isCalling]);

    // WebRTC signaling effect
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
                        peerConnection = new RTCPeerConnection();
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
    }, [supabase, localStream, room.id, isCalling]); // Add isCalling to dependencies

    return (
        <div className="w-full max-w-6xl h-full p-8 bg-n800 rounded-2xl flex flex-col gap-4">
            {/* All the remote audio streams are rendered here, but they are hidden. */}
            <div className="hidden">
                {remoteStreams.map((stream, index) => (
                    <RemoteAudio key={index} stream={stream} isSilenced={isSilenced} />
                ))}
            </div>

            {/* --- Chat Header --- */}
            <div className="flex justify-between items-center pb-4 border-b border-n700">
                <h2 className="text-3xl font-bold text-n100">Room: {room.name}</h2>
                <button
                    onClick={handleLeaveRoom}
                    className="text-white font-bold text-2xl py-2 px-4 rounded-md hover:bg-red-700 transition-all duration-200"
                >
                    X
                </button>
            </div>

            {/* --- Active Participants and WebRTC Controls --- */}
            <div className="flex justify-between pb-4">
                <div className="flex flex-col gap-2">
                    <h3 className="text-xl font-semibold text-n100">Active Participants</h3>
                    {participants.length > 0 ? (
                        <ul className="flex flex-wrap gap-2 text-n300">
                            <li className="bg-n700 px-3 py-1 rounded-full text-sm">
                                <span style={{ color: user.color }}>{user.name} (You)</span>
                            </li>
                            {participants.map((p) => (
                                <li key={p.id} className="bg-n700 px-3 py-1 rounded-full text-sm">
                                    <span style={{ color: p.user_color }}>{p.user_name}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-n500">No other users in this room.</p>
                    )}
                </div>
                <div className="flex gap-2 justify-between items-center">
                    {isCalling && (
                        <>
                            <button
                                onClick={toggleMute}
                                className={`font-bold py-2 px-6 rounded-lg transition-colors duration-200 ${
                                    isMuted
                                        ? "bg-red-600 hover:bg-red-700 text-white"
                                        : "bg-n600 hover:bg-n500 text-n100"
                                }`}
                            >
                                {isMuted ? "Unmute" : "Mute"}
                            </button>
                            <button
                                onClick={toggleSilence}
                                className={`font-bold py-2 px-6 rounded-lg transition-colors duration-200 ${
                                    isSilenced
                                        ? "bg-red-600 hover:bg-red-700 text-white"
                                        : "bg-n600 hover:bg-n500 text-n100"
                                }`}
                            >
                                {isSilenced ? "Unsilence" : "Silence"}
                            </button>
                        </>
                    )}
                    <button
                        onClick={isCalling ? endCall : startCall}
                        className={`font-bold py-2 px-6 rounded-lg transition-colors duration-200 ${
                            isCalling
                                ? "bg-red-600 hover:bg-red-700 text-white"
                                : "bg-green-600 hover:bg-green-700 text-white"
                        }`}
                    >
                        {isCalling ? "Disconnect" : "Start Voice Chat"}
                    </button>
                </div>
            </div>

            {/* --- Message Container --- */}
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto pr-4 flex flex-col">
                {messages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-n300 text-lg">
                        <p>No messages yet. Say hello!</p>
                    </div>
                ) : (
                    messages.map((message, index) => {
                        const previousMessage = messages[index - 1];
                        const showName = !previousMessage || previousMessage.user_id !== message.user_id;

                        return (
                            <div
                                key={message.id}
                                className="flex flex-col max-w-[80%]"
                                style={{ marginLeft: message.user_id === localUserId.current ? "auto" : "0" }}
                            >
                                {showName && (
                                    <span
                                        style={{
                                            color:
                                                participants.find((p) => p.id === message.user_id)?.user_color ||
                                                localStorage.getItem("userColor"),
                                        }}
                                        className="font-semibold mt-4"
                                    >
                                        {message.user_name}
                                    </span>
                                )}
                                <div className="bg-n700 flex gap-2 items-center rounded-lg p-3 mt-2 w-fit">
                                    <p className="text-n100">{message.content}</p>
                                    <span className="text-n400 text-xs h-fit text-nowrap">
                                        {new Date(message.created_at).toLocaleTimeString("en-GB", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* --- Message Input Form --- */}
            <form onSubmit={handleSendMessage} className="flex gap-4 pt-4 border-t border-n700">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 p-3 bg-n700 text-n100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <button
                    type="submit"
                    disabled={isSending}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors duration-200 disabled:bg-n500 disabled:pointer-events-none"
                >
                    {isSending ? "Sending..." : "Send"}
                </button>
            </form>
        </div>
    );
};

export default ChatRoom;
