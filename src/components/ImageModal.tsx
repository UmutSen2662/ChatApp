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
    const [ignoreNextClick, setIgnoreNextClick] = useState(false); // block overlay click after drag
    const imageRef = useRef<HTMLImageElement>(null);

    const stateRef = useRef({ zoom, position });
    useEffect(() => {
        stateRef.current = { zoom, position };
    }, [zoom, position]);

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

                setZoom(finalZoom);
                setPosition(clampPosition(newPosition, finalZoom, true));
            }
        };

        window.addEventListener("wheel", handleScroll, { passive: false });
        return () => window.removeEventListener("wheel", handleScroll);
    }, []);

    // Dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        setTransitionEnabled(false);
        setStartDrag({ x: e.clientX - position.x, y: e.clientY - position.y });
        setIgnoreNextClick(true); // start ignoring overlay clicks
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const rawPosition = { x: e.clientX - startDrag.x, y: e.clientY - startDrag.y };
            setPosition(clampPosition(rawPosition, zoom, true));
        };

        const handleMouseUp = () => {
            if (!isDragging) return;
            setIsDragging(false);
            setTransitionEnabled(true);
            setPosition(clampPosition(position, zoom, false));

            // reset ignore flag after drag ends
            setTimeout(() => setIgnoreNextClick(false), 0);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, startDrag, zoom, position]);

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
