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
    const [transitionEnabled, setTransitionEnabled] = useState(false);
    const [ignoreNextClick, setIgnoreNextClick] = useState(false);

    const imageRef = useRef<HTMLImageElement>(null);
    const lastTapRef = useRef<number>(0);

    const ELASTIC_MARGIN = 50;
    const PADDING = 50;

    const clampPosition = (pos: { x: number; y: number }, zoom: number, elastic = false) => {
        if (!imageRef.current) return pos;

        const naturalWidth = imageRef.current.naturalWidth;
        const naturalHeight = imageRef.current.naturalHeight;

        const imgScaledWidth = naturalWidth * zoom;
        const imgScaledHeight = naturalHeight * zoom;

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const maxX = Math.max(0, (imgScaledWidth - (viewportWidth - PADDING * 2)) / 2);
        const minX = -maxX;
        const maxY = Math.max(0, (imgScaledHeight - (viewportHeight - PADDING * 2)) / 2);
        const minY = -maxY;

        const margin = elastic ? ELASTIC_MARGIN : 0;

        return {
            x: Math.max(minX - margin, Math.min(maxX + margin, pos.x)),
            y: Math.max(minY - margin, Math.min(maxY + margin, pos.y)),
        };
    };

    // Mouse wheel zoom (desktop)
    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            if (!imageRef.current) return;

            const rect = imageRef.current.getBoundingClientRect();
            const mouseX = e.clientX - rect.left - rect.width / 2;
            const mouseY = e.clientY - rect.top - rect.height / 2;

            const newZoom = e.deltaY > 0 ? zoom / 1.1 : zoom * 1.1;
            const finalZoom = Math.min(8, Math.max(1, newZoom));

            if (finalZoom !== zoom) {
                const zoomRatio = finalZoom / zoom;
                const newPosition = {
                    x: position.x - mouseX * (zoomRatio - 1),
                    y: position.y - mouseY * (zoomRatio - 1),
                };
                setZoom(finalZoom);
                setPosition(clampPosition(newPosition, finalZoom, true));
            }
        };

        window.addEventListener("wheel", handleWheel, { passive: false });
        return () => window.removeEventListener("wheel", handleWheel);
    }, [zoom, position]);

    // Dragging (mouse + touch)
    const startDragHandler = (clientX: number, clientY: number) => {
        setIsDragging(true);
        setTransitionEnabled(false);
        setStartDrag({ x: clientX - position.x, y: clientY - position.y });
        setIgnoreNextClick(true);
    };

    const moveDragHandler = (clientX: number, clientY: number) => {
        if (!isDragging) return;
        const rawPos = { x: clientX - startDrag.x, y: clientY - startDrag.y };
        setPosition(clampPosition(rawPos, zoom, true));
    };

    const endDragHandler = () => {
        if (!isDragging) return;
        setIsDragging(false);
        setTransitionEnabled(true);
        setPosition(clampPosition(position, zoom, false));
        setTimeout(() => setIgnoreNextClick(false), 0);
    };

    // Mouse events
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        startDragHandler(e.clientX, e.clientY);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => moveDragHandler(e.clientX, e.clientY);
        const handleMouseUp = () => endDragHandler();

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, startDrag, position, zoom]);

    // Touch events
    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            const now = Date.now();

            // Double-tap detection
            if (now - lastTapRef.current < 300) {
                // Toggle zoom
                const newZoom = zoom === 1 ? 1.5 : 1;
                setZoom(newZoom);
                setPosition({ x: 0, y: 0 });
            }
            lastTapRef.current = now;

            startDragHandler(touch.clientX, touch.clientY);
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            moveDragHandler(touch.clientX, touch.clientY);
        }
    };

    const handleTouchEnd = () => endDragHandler();

    // Reset on image change
    useEffect(() => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
        setTransitionEnabled(false);
        setIgnoreNextClick(false);
    }, [imageUrl]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur p-4"
            onClick={() => {
                if (!ignoreNextClick) onClose();
            }}
        >
            <div
                className="relative cursor-grab"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transition: transitionEnabled ? "transform 0.2s ease-out" : "none",
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
