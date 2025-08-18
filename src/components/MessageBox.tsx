import { useState, useEffect, useRef } from "react";

const MessageBox = ({ supabase, room, user, localUserId }: any) => {
    // Message and UI states
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [isSending, setIsSending] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const MAX_MESSAGE_LENGTH = 2000;

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

    // Auto-resize the textarea based on content
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height to recalculate
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [newMessage]);

    // Keyboard event handler for Enter and Shift+Enter
    const handleKeyDown = (e: any) => {
        if (e.key === "Enter") {
            // If only Enter, send the message
            if (!e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
            }
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
                                    <span
                                        style={{
                                            color: message.user_color,
                                            marginLeft: message.user_id === localUserId ? "auto" : "0",
                                        }}
                                        className="font-semibold mt-4"
                                    >
                                        {message.user_name}
                                    </span>
                                )}
                                <div className="bg-n700 flex gap-2 items-center rounded-lg p-3 mt-2 w-fit whitespace-pre-wrap">
                                    <p className="text-n100">{message.content}</p>
                                    <span className="text-n400 text-xs h-fit text-nowrap mt-auto">
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
            <form onSubmit={handleSendMessage} className="flex gap-4 pt-4 border-t border-n700 items-end relative">
                <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onKeyDown={handleKeyDown}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className={"flex-1 p-3 bg-n700 text-n100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none overflow-hidden".concat(
                        MAX_MESSAGE_LENGTH - newMessage.length < 100 ? " pr-16" : ""
                    )}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={1}
                    style={{ minHeight: "3rem", maxHeight: "6rem" }}
                />
                <button
                    type="submit"
                    disabled={isSending || newMessage.trim().length === 0}
                    className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-lg transition-colors duration-200 disabled:bg-n500 disabled:pointer-events-none"
                >
                    {isSending ? (
                        <span className="w-8 h-8 ellipsis"></span>
                    ) : (
                        <img className="w-8 h-8" src="send.svg" alt="Send Icon" />
                    )}
                </button>
                {MAX_MESSAGE_LENGTH - newMessage.length < 100 && (
                    <div className="absolute right-18 bottom-2 text-xs text-n400">
                        <span>
                            {newMessage.length}/{MAX_MESSAGE_LENGTH}
                        </span>
                    </div>
                )}
            </form>
        </>
    );
};

export default MessageBox;
