// components/Chat.tsx
import { useState, useEffect, useRef } from "react";

const MessageBox = ({ supabase, room, user, localUserId }: any) => {
    // Message and UI states
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // Function to fetch initial messages and set up real-time subscription
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

    // Auto-scroll to the bottom when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Function to send a new message
    const handleSendMessage = async (e: any) => {
        e.preventDefault();
        if (newMessage.trim() === "") return;

        setIsSending(true);

        try {
            await supabase.from("messages").insert({
                room_id: room.id,
                user_id: localUserId,
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

    return (
        <>
            {/* Message Container */}
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
                                style={{ marginLeft: message.user_id === localUserId ? "auto" : "0" }}
                            >
                                {showName && (
                                    <span style={{ color: message.user_color }} className="font-semibold mt-4">
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

            {/* Message Input Form */}
            <form onSubmit={handleSendMessage} className="flex gap-4 pt-4 border-t border-n700">
                <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 min-w-16 p-3 bg-n700 text-n100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <button
                    type="submit"
                    disabled={isSending}
                    className="w-12 bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-lg overflow-hidden transition-colors duration-200 disabled:bg-n500 disabled:pointer-events-none"
                >
                    {isSending ? (
                        <span className="w-8 h-8 ellipsis"></span>
                    ) : (
                        <img className="w-8 h-8" src="send.svg" alt="Send Icon" />
                    )}
                </button>
            </form>
        </>
    );
};

export default MessageBox;
