import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

const SignaturePad = ({ onChange, className = '' }) => {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, canvas.clientWidth);
    canvas.width = width * ratio;
    canvas.height = 180 * ratio;
    const context = canvas.getContext('2d');
    context.scale(ratio, ratio);
    context.lineWidth = 2.25;
    context.lineCap = 'round';
    context.strokeStyle = '#0f172a';
  }, []);

  const point = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const start = (event) => {
    event.preventDefault();
    canvasRef.current.setPointerCapture?.(event.pointerId);
    const context = canvasRef.current.getContext('2d');
    const current = point(event);
    context.beginPath(); context.moveTo(current.x, current.y); setDrawing(true);
  };
  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const current = point(event);
    const context = canvasRef.current.getContext('2d');
    context.lineTo(current.x, current.y); context.stroke();
  };
  const stop = () => {
    if (!drawing) return;
    setDrawing(false); onChange?.(canvasRef.current.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); onChange?.('');
  };
  return <div className={`space-y-2 ${className}`}>
    <canvas ref={canvasRef} role="img" aria-label="Podpisové pole" className="h-[180px] w-full touch-none rounded-lg border border-slate-300 bg-white shadow-inner"
      onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} />
    <Button type="button" variant="outline" size="sm" onClick={clear}>Vymazat podpis</Button>
  </div>;
};

export default SignaturePad;
