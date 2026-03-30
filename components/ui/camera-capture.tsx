'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Camera, X, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Image from 'next/image'

interface CameraCaptureProps {
  onCapture: (file: File) => void
  preview?: string | null       // blob URL or existing URL to show
  label?: string
  error?: boolean
  className?: string
}

export function CameraCapture({ onCapture, preview, label, error, className }: CameraCaptureProps) {
  const [open, setOpen] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [captured, setCaptured] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Attach stream to video element whenever stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream, open])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setCaptured(null)
    setOpen(true)
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      setStream(mediaStream)
    } catch (err: any) {
      setCameraError(err?.message ?? 'Could not access camera. Please allow camera permission.')
    }
  }, [])

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setOpen(false)
    setCaptured(null)
    setCameraError(null)
  }, [stream])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    setCaptured(canvas.toDataURL('image/jpeg', 0.92))
    // Stop the stream after capture — no longer needed
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
  }, [stream])

  const retake = useCallback(async () => {
    setCaptured(null)
    setCameraError(null)
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      setStream(mediaStream)
    } catch (err: any) {
      setCameraError(err?.message ?? 'Could not access camera.')
    }
  }, [])

  const confirm = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })
      onCapture(file)
      stopCamera()
    }, 'image/jpeg', 0.92)
  }, [onCapture, stopCamera])

  return (
    <>
      {/* Trigger area */}
      <div
        className={`border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${
          error
            ? 'border-red-300 bg-red-50 hover:border-red-400'
            : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
        } ${className ?? ''}`}
        onClick={startCamera}
      >
        <Camera className={`h-5 w-5 mx-auto mb-1 ${error ? 'text-red-400' : 'text-gray-400'}`} />
        <p className={`text-sm font-medium ${error ? 'text-red-600' : 'text-gray-500'}`}>
          {label ?? 'Tap to take a photo'}
        </p>
        <p className={`text-xs mt-0.5 ${error ? 'text-red-400' : 'text-gray-400'}`}>Opens camera</p>
      </div>

      {/* Existing preview (shown below trigger) */}
      {preview && (
        <div className="relative w-fit mt-2">
          <Image
            src={preview}
            alt="Captured photo"
            width={300}
            height={200}
            className="rounded-lg border border-gray-200 object-cover max-h-48"
          />
        </div>
      )}

      {/* Fullscreen camera overlay */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ touchAction: 'none' }}>
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <button
              onClick={stopCamera}
              className="text-white p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Close camera"
            >
              <X className="h-6 w-6" />
            </button>
            <p className="text-white text-sm font-semibold tracking-wide">
              {captured ? 'Use this photo?' : 'Take Photo'}
            </p>
            <div className="w-10" />
          </div>

          {/* Viewfinder */}
          <div className="flex-1 relative overflow-hidden bg-black">
            {cameraError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                <Camera className="h-12 w-12 text-gray-500" />
                <p className="text-white text-center text-sm">{cameraError}</p>
                <Button variant="outline" onClick={stopCamera} className="border-white text-white">
                  Close
                </Button>
              </div>
            ) : !captured ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={captured}
                alt="Preview"
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
          </div>

          {/* Hidden canvas for capture */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Bottom controls */}
          <div className="bg-black/80 px-6 py-8 flex items-center justify-center gap-8">
            {!cameraError && !captured ? (
              /* Shutter button */
              <button
                onClick={capture}
                className="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center"
                style={{ width: 72, height: 72 }}
                aria-label="Capture photo"
              >
                <div className="w-14 h-14 rounded-full bg-white" />
              </button>
            ) : captured ? (
              <>
                <button
                  onClick={retake}
                  className="flex flex-col items-center gap-1 text-white opacity-80 hover:opacity-100 transition-opacity"
                >
                  <RotateCcw className="h-6 w-6" />
                  <span className="text-xs">Retake</span>
                </button>
                <button
                  onClick={confirm}
                  className="px-8 py-3 rounded-full bg-white text-black font-semibold text-sm hover:bg-gray-100 transition-colors"
                >
                  Use Photo
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </>
  )
}
