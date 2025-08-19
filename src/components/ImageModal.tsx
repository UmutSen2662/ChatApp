import React, { useState, useRef, useEffect } from "react";

interface ImageModalProps {
    imageUrl: string;
    onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ imageUrl, onClose }) => {
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [startDrag, setStartDrag] = useState({ x: 0, y: 0 });
    const imageRef = useRef<HTMLImageElement>(null);

    const stateRef = useRef({ zoom, position });
    useEffect(() => {
        stateRef.current = { zoom, position };
    }, [zoom, position]);

    // Clamp position based on image natural size and viewport
    const clampPosition = (pos: { x: number; y: number }, zoom: number) => {
        if (!imageRef.current) return pos;

        const naturalWidth = imageRef.current.naturalWidth;
        const naturalHeight = imageRef.current.naturalHeight;

        const imgScaledWidth = naturalWidth * zoom;
        const imgScaledHeight = naturalHeight * zoom;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const maxX = Math.max(0, (imgScaledWidth - viewportWidth) / 2);
        const minX = -maxX;
        const maxY = Math.max(0, (imgScaledHeight - viewportHeight) / 2);
        const minY = -maxY;

        return {
            x: Math.max(minX, Math.min(maxX, pos.x)),
            y: Math.max(minY, Math.min(maxY, pos.y)),
        };
    };

    // Zoom handler
    useEffect(() => {
        const handleScroll = (e: WheelEvent) => {
            e.preventDefault();
            if (!imageRef.current) return;

            const { zoom: currentZoom, position: currentPosition } = stateRef.current;
            const rect = imageRef.current.getBoundingClientRect();

            const mouseX = e.clientX - rect.left - rect.width / 2;
            const mouseY = e.clientY - rect.top - rect.height / 2;

            const newZoom = e.deltaY > 0 ? currentZoom / 1.1 : currentZoom * 1.1;
            const finalZoom = Math.min(8, Math.max(1, newZoom));

            if (finalZoom !== currentZoom) {
                const zoomRatio = finalZoom / currentZoom;
                const newPosition = {
                    x: currentPosition.x - mouseX * (zoomRatio - 1),
                    y: currentPosition.y - mouseY * (zoomRatio - 1),
                };
                setPosition(clampPosition(newPosition, finalZoom));
                setZoom(finalZoom);
            }
        };

        window.addEventListener("wheel", handleScroll, { passive: false });
        return () => window.removeEventListener("wheel", handleScroll);
    }, []);

    // Drag handlers
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setStartDrag({ x: e.clientX - position.x, y: e.clientY - position.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        const rawPosition = { x: e.clientX - startDrag.x, y: e.clientY - startDrag.y };
        setPosition(clampPosition(rawPosition, zoom));
    };

    const handleMouseUp = () => setIsDragging(false);

    // Reset on image change
    useEffect(() => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
    }, [imageUrl]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur p-4"
            onClick={onClose}
        >
            <div
                className="relative cursor-grab"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transition: isDragging ? "none" : "transform 0.15s ease-out",
                    transformOrigin: "center center",
                }}
            >
                <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="Full-size"
                    className="max-w-full max-h-screen object-contain"
                    style={{ pointerEvents: "none" }}
                />
            </div>
        </div>
    );
};

export default ImageModal;
