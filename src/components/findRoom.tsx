import { useState, useEffect } from "react";

const FindRoom = ({ supabase, user, setUser, onRoomSelect }: any) => {
    // --- Generate a unique user ID on first load and store in localStorage
    // This part is crucial for identifying the user across sessions
    useEffect(() => {
        let userId = localStorage.getItem("userId");
        if (!userId) {
            userId = crypto.randomUUID();
            localStorage.setItem("userId", userId);
        }
    }, []);

    // State for local UI logic
    const [rooms, setRooms] = useState<any[]>([]);
    const [selectedRoom, setSelectedRoom] = useState<any>(null);
    const [passwordInput, setPasswordInput] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [newRoomName, setNewRoomName] = useState("");
    const [newRoomPassword, setNewRoomPassword] = useState("");
    const [createRoomLoading, setCreateRoomLoading] = useState(false);
    const [createRoomMessage, setCreateRoomMessage] = useState("");

    // --- Helper function to fetch initial rooms from Supabase
    const fetchRooms = async () => {
        if (!supabase) return;

        try {
            const { data, error } = await supabase.from("rooms").select("*");
            if (error) {
                throw error;
            }
            setRooms(data);
            console.log("Rooms fetched:", data);
        } catch (e: any) {
            console.error("Error fetching rooms:", e.message);
            setError("Failed to load rooms. Please check your Supabase connection.");
        } finally {
            setLoading(false);
        }
    };

    // --- Handle joining a room
    const handleJoinRoom = async (room: any, passwordAttempt: string) => {
        if (room.password !== passwordAttempt) {
            setError("Incorrect password.");
            return;
        }
        setError("");
        console.log(`Joined room: ${room.name}`);
        onRoomSelect(room);
    };

    // --- Handle creating a new room
    const handleCreateRoom = async () => {
        if (!supabase) {
            setCreateRoomMessage("Supabase not ready.");
            return;
        }
        if (!newRoomName || !newRoomPassword) {
            setCreateRoomMessage("Room name and password are required.");
            return;
        }

        setCreateRoomLoading(true);
        setCreateRoomMessage("");

        try {
            // First, check if a room with the same name already exists
            const { data: existingRooms, error: checkError } = await supabase
                .from("rooms")
                .select("name")
                .eq("name", newRoomName);

            if (checkError) {
                throw checkError;
            }

            if (existingRooms && existingRooms.length > 0) {
                setCreateRoomMessage("A room with this name already exists. Please choose a different name.");
                setCreateRoomLoading(false);
                return;
            }

            // Insert the new room and select the created row
            // The database will now automatically generate a UUID for the 'id'
            const { data, error } = await supabase
                .from("rooms")
                .insert([{ name: newRoomName, password: newRoomPassword }])
                .select();

            if (error) {
                throw error;
            }

            if (data && data.length > 0) {
                const newRoom = data[0];
                setCreateRoomMessage(`Room "${newRoomName}" created successfully!`);

                // Automatically join the newly created room
                handleJoinRoom(newRoom, newRoomPassword);

                setNewRoomName("");
                setNewRoomPassword("");
            }
        } catch (e: any) {
            console.error("Error creating room:", e.message);
            setCreateRoomMessage("Failed to create room. Please try again.");
        } finally {
            setCreateRoomLoading(false);
        }
    };

    // Use a single useEffect for fetching rooms and setting up the real-time subscription
    useEffect(() => {
        if (supabase) {
            fetchRooms();

            const roomSubscription = supabase
                .channel("rooms")
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "rooms",
                    },
                    () => {
                        fetchRooms();
                    }
                )
                .subscribe();

            return () => {
                roomSubscription.unsubscribe();
            };
        }
    }, [supabase]);

    return (
        <div className="w-full bg-n900 text-n100 p-4 flex items-center justify-center font-inter">
            <div className="w-full max-w-6xl max-h-full p-8 bg-n800 rounded-2xl shadow-xl flex flex-col md:flex-row gap-8">
                {/* Left Panel: Room Finder */}
                <div className="w-full md:w-2/3 p-4 bg-n700 rounded-xl shadow-inner flex flex-col gap-4">
                    <h2 className="text-2xl font-bold text-n100">Room Finder</h2>
                    <input
                        type="text"
                        placeholder="Search for a room..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                        {loading ? (
                            <p className="text-n300">Loading rooms...</p>
                        ) : rooms.length === 0 ? (
                            <p className="text-n300">No rooms available. Create one!</p>
                        ) : (
                            rooms
                                .filter((room: any) => room.name.toLowerCase().includes(searchQuery.toLowerCase()))
                                .map((room: any) => (
                                    <div
                                        key={room.id}
                                        className="bg-n600 rounded-lg p-4 transition-all select-none duration-200 ease-in-out cursor-pointer"
                                    >
                                        <div
                                            onClick={() => setSelectedRoom(selectedRoom?.id === room.id ? null : room)}
                                            className="flex justify-between items-center"
                                        >
                                            <span className="text-lg font-semibold">{room.name}</span>
                                            {selectedRoom?.id === room.id ? (
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    className="h-6 w-6 transform rotate-180 transition-transform"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M19 9l-7 7-7-7"
                                                    />
                                                </svg>
                                            ) : (
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    className="h-6 w-6 transition-transform"
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M19 9l-7 7-7-7"
                                                    />
                                                </svg>
                                            )}
                                        </div>

                                        {/* Password entry field (only shows when room is selected) */}
                                        {selectedRoom?.id === room.id && (
                                            <div className="mt-4 flex flex-col gap-2">
                                                <div className="flex flex gap-2">
                                                    <input
                                                        type="password"
                                                        placeholder="Enter password"
                                                        value={passwordInput}
                                                        onChange={(e) => setPasswordInput(e.target.value)}
                                                        className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                                    />
                                                    <button
                                                        onClick={() => handleJoinRoom(room, passwordInput)}
                                                        className="w-fit text-nowrap bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-md transition-colors duration-200"
                                                    >
                                                        Join Room
                                                    </button>
                                                </div>
                                                {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                                            </div>
                                        )}
                                    </div>
                                ))
                        )}
                    </div>
                </div>

                {/* Right Panel: User Settings and Create Room */}
                <div className="w-full md:w-1/3 flex flex-col gap-8">
                    {/* User Settings */}
                    <div className="p-4 bg-n700 rounded-xl shadow-inner flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold text-n100">Your Identity</h2>
                            <label className="block text-n300">Username</label>
                            <input
                                type="text"
                                placeholder="Choose a username"
                                value={user.name}
                                onChange={(e) => setUser({ ...user, name: e.target.value })}
                                className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="block text-n300 pointer-events-none">Color</p>
                            <div className="flex space-x-2">
                                {["#ff6666", "#66ff66", "#6666ff", "#ffff66", "#ff66ff", "#66ffff"].map((color) => (
                                    <div
                                        key={color}
                                        onClick={() => setUser({ ...user, color: color })}
                                        className={`w-8 h-8 rounded-full border-2 cursor-pointer transition-all duration-200 ${
                                            user.color === color
                                                ? "border-black ring-2 ring-white"
                                                : "border-transparent"
                                        }`}
                                        style={{ backgroundColor: color }}
                                    />
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 flex items-end">
                            <p className="text-sm text-n300">
                                Your username will be <span style={{ color: user.color }}>{user.name}</span> in the
                                chat.
                            </p>
                        </div>
                    </div>

                    {/* Create Room Panel */}
                    <div className="p-4 bg-n700 rounded-xl shadow-inner flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold text-n100">Create a Room</h2>
                            <label className="block text-n300">Room Name</label>
                            <input
                                type="text"
                                placeholder="Enter room name"
                                value={newRoomName}
                                onChange={(e) => setNewRoomName(e.target.value)}
                                className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                            <label className="block text-n300">Password</label>
                            <input
                                type="password"
                                placeholder="Enter password"
                                value={newRoomPassword}
                                onChange={(e) => setNewRoomPassword(e.target.value)}
                                className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={handleCreateRoom}
                            disabled={createRoomLoading || !supabase}
                            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 disabled:bg-n500 disabled:pointer-events-none"
                        >
                            {createRoomLoading ? "Creating..." : "Create Room"}
                        </button>
                        <p
                            className={`text-sm ${
                                createRoomMessage.includes("successfully") ? "text-green-400" : "text-red-400"
                            }`}
                        >
                            {createRoomMessage}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FindRoom;
