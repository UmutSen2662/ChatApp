import { useState, useEffect, useRef } from "react";

const MessageBox = ({ supabase, room, user, localUserId }: any) => {
    // Message and UI states
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({});
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
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

    // Update last_active_at when the component mounts and on a timer
    useEffect(() => {
        const updateLastActive = async () => {
            if (supabase) {
                try {
                    await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", room.id);
                } catch (e: any) {
                    console.error("Error updating last_active_at:", e.message);
                }
            }
        };

        // Update on mount
        updateLastActive();

        // Also update every 30 seconds to keep the timestamp fresh
        const interval = setInterval(updateLastActive, 30 * 1000);

        // Cleanup the interval
        return () => clearInterval(interval);
    }, [supabase, room.id]);

    // Auto-scroll to the bottom when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Auto-resize the textarea based on content
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height to recalculate
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [newMessage]);

    // Function to handle image selection and conversion to WebP or retain GIF
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            // If the file is a GIF, bypass conversion and use the original file
            if (file.type === "image/gif") {
                setImageFile(file);
                setImagePreview(URL.createObjectURL(file));
            } else {
                // For other image types, convert to WebP
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext("2d");
                        ctx?.drawImage(img, 0, 0);

                        canvas.toBlob(
                            (blob) => {
                                if (blob) {
                                    const webpFileName = `${file.name.split(".")[0]}.webp`;
                                    const webpFile = new File([blob], webpFileName, { type: "image/webp" });
                                    setImageFile(webpFile);
                                    setImagePreview(URL.createObjectURL(webpFile));
                                }
                            },
                            "image/webp",
                            0.8
                        ); // 0.8 is the quality
                    };
                    img.src = event.target?.result as string;
                };
                reader.readAsDataURL(file);
            }
        }
    };

    // Function to upload the image to Supabase Storage
    const uploadImage = async (file: File) => {
        const filePath = `${room.id}/${localUserId}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from("chat-images").upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
        });

        if (error) {
            throw error;
        }

        const { data: publicURLData } = supabase.storage.from("chat-images").getPublicUrl(filePath);

        return publicURLData.publicUrl;
    };

    // Function to send a new message
    const handleSendMessage = async (e: any) => {
        e.preventDefault();
        if (newMessage.trim() === "" && !imageFile) return;

        setIsSending(true);

        try {
            let imageUrl = null;
            if (imageFile) {
                imageUrl = await uploadImage(imageFile);
            }

            // Update the last_active_at timestamp before inserting the new message
            await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", room.id);

            await supabase.from("messages").insert({
                room_id: room.id,
                user_id: localUserId,
                user_name: user.name,
                user_color: user.color,
                content: newMessage,
                image_url: imageUrl,
            });

            setNewMessage(""); // Clear the input field after successful send
            setImageFile(null); // Clear image file
            setImagePreview(null); // Clear image preview
        } catch (e: any) {
            console.error("Error sending message:", e.message);
        } finally {
            setIsSending(false);
        }
    };

    // Keyboard event handler for Enter and Shift+Enter
    const handleKeyDown = (e: any) => {
        if (isSending) {
            e.preventDefault();
            return;
        } else if (e.key === "Enter") {
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

                        // Set loading state when the message is first rendered with an image
                        if (message.image_url && imageLoading[message.image_url] === undefined) {
                            setImageLoading((prev) => ({ ...prev, [message.image_url]: true }));
                        }

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
                                    <div className={message.image_url ? "max-w-100 flex flex-col gap-2" : ""}>
                                        {message.image_url && imageLoading[message.image_url] && (
                                            <div className="w-64 h-48 bg-n600 rounded-lg animate-pulse flex items-center justify-center text-n300">
                                                Loading...
                                            </div>
                                        )}
                                        {message.image_url && (
                                            <img
                                                src={message.image_url}
                                                alt="Chat Image"
                                                className={`max-h-64 rounded-lg object-contain ${
                                                    imageLoading[message.image_url] ? "hidden" : "block"
                                                }`}
                                                onLoad={() =>
                                                    setImageLoading((prev) => ({ ...prev, [message.image_url]: false }))
                                                }
                                                onError={() => {
                                                    console.error(`Error loading image from ${message.image_url}`);
                                                    setImageLoading((prev) => ({
                                                        ...prev,
                                                        [message.image_url]: false,
                                                    }));
                                                }}
                                            />
                                        )}
                                        <p className="text-n100">{message.content}</p>
                                    </div>
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
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    ref={imageInputRef}
                    className="hidden"
                />
                {imagePreview && (
                    <div className="absolute -top-20 left-0 pl-2 bg-n700 rounded-lg flex items-center">
                        <img src={imagePreview} alt="Image Preview" className="h-12 w-16 object-cover rounded-md" />
                        <button
                            onClick={() => {
                                setImageFile(null);
                                setImagePreview(null);
                            }}
                            className="text-n300 hover:text-red-500 w-10 h-16 font-bold text-xl"
                        >
                            X
                        </button>
                    </div>
                )}
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
                {newMessage.trim().length === 0 && !imageFile ? (
                    <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="w-12 h-12 bg-n700 hover:bg-n600 text-n100 rounded-lg transition-colors duration-200"
                    >
                        <svg
                            className="w-6 h-6 mx-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                fillRule="evenodd"
                                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                                clipRule="evenodd"
                            ></path>
                        </svg>
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={isSending}
                        className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-lg transition-colors duration-200 disabled:bg-n700 disabled:pointer-events-none"
                    >
                        {isSending ? (
                            <span className="w-8 h-8 ellipsis"></span>
                        ) : (
                            <img className="w-8 h-8" src="send.svg" alt="Send Icon" />
                        )}
                    </button>
                )}
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
