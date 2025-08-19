import React, { useState, useRef, useEffect } from "react";

interface ImageModalProps {
    imageUrl: string;
    onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ imageUrl, onClose }) => {
    // State to manage the image's transform properties
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });
    const imageContainerRef = useRef<HTMLDivElement>(null);

    // Use useEffect to manually add the non-passive event listener
    useEffect(() => {
        const handleScroll = (e: WheelEvent) => {
            e.preventDefault();

            if (!imageContainerRef.current) return;

            const newZoom = e.deltaY > 0 ? zoom / 1.1 : zoom * 1.1;
            const finalZoom = Math.min(8, Math.max(1, newZoom));

            const zoomRatio = finalZoom / zoom;

            // Get mouse position relative to the container's current state
            const rect = imageContainerRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            // Calculate new position to anchor the zoom to the cursor
            const newPosition = {
                x: mouseX - (mouseX - position.x) * zoomRatio,
                y: mouseY - (mouseY - position.y) * zoomRatio,
            };
            console.log(mouseX * zoomRatio, mouseX);

            setZoom(finalZoom);
            setPosition(newPosition);
        };

        const container = imageContainerRef.current;
        if (container) {
            container.addEventListener("wheel", handleScroll, { passive: false });
        }

        return () => {
            if (container) {
                container.removeEventListener("wheel", handleScroll);
            }
        };
    }, [zoom, position]); // The dependency array must include `zoom` and `position` to get the latest state

    // Mouse down event to start dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setStartDrag({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    // Mouse move event to update the image's position
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        setPosition({
            x: e.clientX - startDrag.x,
            y: e.clientY - startDrag.y,
        });
    };

    // Mouse up event to stop dragging
    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Reset zoom and position when the modal opens or the image changes
    useEffect(() => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
    }, [imageUrl]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur p-4"
            onClick={onClose}
        >
            {/* The modal content, preventing click events from bubbling to the overlay */}
            <div
                ref={imageContainerRef}
                className={"relative cursor-grab"}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transition: isDragging ? "none" : "transform 0.2s ease-out",
                    transformOrigin: "center center",
                }}
            >
                <img
                    src={imageUrl}
                    alt="Full-size image"
                    className="max-w-full max-h-screen object-contain"
                    style={{
                        pointerEvents: "none",
                    }}
                />
            </div>
        </div>
    );
};

export default ImageModal;
