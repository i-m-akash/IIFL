// @ts-nocheck
import React, { useRef, useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, CircleStop, Volume2, Waves, Activity, Wifi, WifiOff } from 'lucide-react'

const CHUNK_SIZE =  1024
const TARGET_SR = 24000


// PCM/Base64 helpers
const floatTo16BitPCM = input => {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
  }
  return out
}

const pcmToBase64 = pcm => btoa(String.fromCharCode.apply(null, new Uint8Array(pcm.buffer)))

const base64ToFloat32 = b64 => {
  try {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    
    // Handle different byte alignments
    if (bytes.length % 2 !== 0) {
      bytes.length = bytes.length - 1
    }
    
  const pcm = new Int16Array(bytes.buffer)
  const f32 = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768
  return f32
  } catch (error) {
    return null
  }
}

// Simple WebSocket wrapper
class WSManager {
  constructor(url) {
    this.url = url
    this.ws = null
  }

  connect(onOpen, onMessage, onError, onClose) {
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      onOpen()
    }
    this.ws.onmessage = onMessage
    this.ws.onerror = onError
    this.ws.onclose = onClose
  }

  send(data) {
    if (this.ws?.readyState === 1) this.ws.send(data)
  }

  close() {
    this.ws?.close()
  }
}

const StatusBadge = ({ status, agentSpeaking }) => {
  const map = {
    idle: { text: 'Ready', classes: 'bg-zinc-100 text-zinc-700' },
    connecting: { text: 'Connecting', classes: 'bg-amber-100 text-amber-800' },
    connected: { text: 'Connected', classes: 'bg-blue-100 text-blue-800' },
    recording: { text: 'Listening', classes: 'bg-blue-100 text-blue-800' },
    error: { text: 'Error', classes: 'bg-rose-100 text-rose-800' },
  }

  if (agentSpeaking && status !== 'error') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium bg-purple-100 text-purple-800">
        <motion.span
          className="inline-block h-1.5 w-1.5 rounded-full bg-current"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        AI Speaking
      </span>
    )
  }

  const conf = map[status] ?? map.idle
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${conf.classes}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {conf.text}
    </span>
  )
}

const RingMeter = ({ rms, active, agentSpeaking, onClick, isRecording }) => {
  const clamped = Math.max(0, Math.min(1, rms))
  const glow = clamped * 0.8 + (active || agentSpeaking ? 0.2 : 0)
  const ringColor = agentSpeaking ? 'rgba(147,51,234,0.35)' : 'rgba(59,130,246,0.35)'

  return (
    <motion.div 
      className="relative mx-auto aspect-square w-44 sm:w-56 cursor-pointer"
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      title={isRecording ? "Click to stop" : "Click to start"}
    >
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{ scale: 1 + clamped * 0.6 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18, mass: 0.6 }}
        style={{ boxShadow: `0 0 ${24 + glow * 40}px ${8 + glow * 24}px ${ringColor}` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 rounded-full blur-2xl opacity-30"
        style={{
          background: agentSpeaking
            ? 'linear-gradient(to bottom, rgb(147 51 234 / 0.7), rgb(147 51 234 / 0.7))'
            : 'linear-gradient(to bottom, rgb(59 130 246 / 0.7), rgb(59 130 246 / 0.7))',
        }}
        aria-hidden="true"
      />
      <div className="absolute inset-[8px] rounded-full bg-white/70 shadow-inner backdrop-blur-md" />
      <div className="absolute inset-[22px] rounded-full border border-blue-400/40" />
      <div className="absolute inset-[28px] rounded-full bg-blue-500/10" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Volume2
          className={`h-6 w-6 ${
            agentSpeaking ? 'text-purple-600' : 'text-blue-600'
          }`}
        />
      </div>
      <AnimatePresence>
        {(active || agentSpeaking) && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ background: agentSpeaking ? 'rgb(147 51 234 / 0.1)' : 'rgb(59 130 246 / 0.1)' }}
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 0.4, scale: 1.06 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const AudioLevelBars = ({ rms, agentSpeaking }) => {
  const bars = 24
  const fill = Math.min(Math.floor(rms * bars * 5), bars)
  const barColor = agentSpeaking ? 'bg-purple-500' : 'bg-blue-500'

  return (
    <div className="mt-4 flex h-2 w-full items-center gap-[4px]">
      {Array.from({ length: bars }).map((_, i) => {
        const active = i < fill
        return (
          <motion.div
            key={i}
            className={`h-full flex-1 rounded-sm transition-colors ${active ? barColor : 'bg-zinc-200'}`}
            animate={active && agentSpeaking ? { scaleY: [1, 1.2, 1] } : {}}
            transition={{ duration: 0.3, delay: i * 0.02 }}
          />
        )
      })}
    </div>
  )
}

const AgentPlayground = ({ agentId = 'mobicule_emi' }) => {
  const [status, setStatus] = useState('idle')
  const [rms, setRms] = useState(0)
  const [error, setError] = useState('')
  const [agentSpeaking, setAgentSpeaking] = useState(false)

  // Refs for audio processing and connection
  const audioCtxRef = useRef(null)
  const procRef = useRef(null)
  const streamRef = useRef(null)
  const wsRef = useRef(null)
  const sidRef = useRef('sid-' + Math.random().toString(36).slice(2))
  const audioQueueRef = useRef([])
  const isPlayingRef = useRef(false)
  const currentAudioSourceRef = useRef(null)
  const nextPlayTimeRef = useRef(0)

  // Plays next audio chunk from queue with seamless scheduling
  const playNextInQueue = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      setAgentSpeaking(false)
      nextPlayTimeRef.current = 0
      return
    }
    isPlayingRef.current = true
    setAgentSpeaking(true)
    const data = audioQueueRef.current.shift()
    const ctx = audioCtxRef.current
    if (!ctx) return

    try {
      // Apply audio processing to improve quality
      const processedData = processAudioData(data)
      
      const buf = ctx.createBuffer(1, processedData.length, TARGET_SR)
      buf.copyToChannel(processedData, 0)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      currentAudioSourceRef.current = src

      // Schedule playback time precisely to avoid gaps
      const now = ctx.currentTime
      const startTime = Math.max(now, nextPlayTimeRef.current)
      nextPlayTimeRef.current = startTime + buf.duration

      src.onended = () => {
        if (currentAudioSourceRef.current === src) currentAudioSourceRef.current = null
        playNextInQueue()
      }

      src.start(startTime)
    } catch (err) {
      playNextInQueue() // continue to next chunk
    }
  }, [])

  // Audio processing function to improve quality and reduce muffling
  const processAudioData = useCallback((audioData) => {
    // Normalize audio to prevent clipping
    const maxAmplitude = Math.max(...audioData.map(v => Math.abs(v)))
    if (maxAmplitude > 0.8) {
      const scale = 0.8 / maxAmplitude
      audioData = audioData.map(v => v * scale)
    }

    // Apply gentle high-pass filter to reduce low-frequency noise
    const filteredData = new Float32Array(audioData.length)
    const alpha = 0.95 // High-pass filter coefficient
    let prevSample = 0
    
    for (let i = 0; i < audioData.length; i++) {
      filteredData[i] = alpha * (prevSample + audioData[i] - audioData[i - 1] || 0)
      prevSample = filteredData[i]
    }

    // Apply gentle compression for consistent volume
    const compressedData = new Float32Array(filteredData.length)
    const threshold = 0.6
    const ratio = 2.0
    
    for (let i = 0; i < filteredData.length; i++) {
      const sample = filteredData[i]
      const absSample = Math.abs(sample)
      
      if (absSample > threshold) {
        const excess = absSample - threshold
        const compressed = threshold + (excess / ratio)
        compressedData[i] = sample >= 0 ? compressed : -compressed
      } else {
        compressedData[i] = sample
      }
    }

    return compressedData
  }, [])

  // Handler for incoming websocket messages with robust JSON/Raw handling
  const onMessage = useCallback(
    e => {
      const rawData = e.data

      try {
        const msg = JSON.parse(rawData)
        
        if (msg.event === 'playAudio' && msg.media?.payload) {
          const data = base64ToFloat32(msg.media.payload)
          if (data) {
          const maxAmplitude = Math.max(...data.map(v => Math.abs(v)))
          const isSilent = maxAmplitude < 0.005 // Lenient silence threshold
          if (!isSilent) {
            audioQueueRef.current.push(data)
            if (!isPlayingRef.current) playNextInQueue()
          }
          }
        }
      } catch (jsonError) {
        // If JSON parsing fails, try to treat as raw base64 audio
        if (typeof rawData === 'string' && rawData.length > 100) {
          // More lenient base64 detection - handle data with some invalid characters
          const base64Chars = (rawData.match(/[A-Za-z0-9+/=]/g) || []).length
          const totalChars = rawData.length
          const base64Percentage = base64Chars / totalChars
          
          // If more than 90% of characters are valid base64, try to decode it
          const looksLikeBase64 = base64Percentage > 0.9 && totalChars > 200
          
          if (looksLikeBase64) {
            try {
              // Clean the data by removing invalid characters
              const cleanedData = rawData.replace(/[^A-Za-z0-9+/=]/g, '')
              
              const data = base64ToFloat32(cleanedData)
              if (data) {
                const maxAmplitude = Math.max(...data.map(v => Math.abs(v)))
                const isSilent = maxAmplitude < 0.005
                if (!isSilent) {
                  audioQueueRef.current.push(data)
                  if (!isPlayingRef.current) playNextInQueue()
                }
              }
            } catch (audioError) {
              // Silent fail for audio errors
            }
          } else {
            // Try even more lenient detection for edge cases
            const mightBeBase64 = base64Percentage > 0.8 && totalChars > 50
            if (mightBeBase64) {
              try {
                // Clean the data by removing invalid characters
                const cleanedData = rawData.replace(/[^A-Za-z0-9+/=]/g, '')
                
                const data = base64ToFloat32(cleanedData)
                if (data) {
                  const maxAmplitude = Math.max(...data.map(v => Math.abs(v)))
                  const isSilent = maxAmplitude < 0.005
                  if (!isSilent) {
                    audioQueueRef.current.push(data)
                    if (!isPlayingRef.current) playNextInQueue()
                  }
                }
              } catch (audioError) {
                // Silent fail for audio errors
              }
            }
          }
        }
      }
    },
    [playNextInQueue]
  )

  // Initiate capture and WebSocket connection
  const start = useCallback(async () => {
    setError('')
    setStatus('connecting')

    try {
      audioQueueRef.current = []
      isPlayingRef.current = false
      setAgentSpeaking(false)
      nextPlayTimeRef.current = 0

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: TARGET_SR,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = mic

      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_SR })
      audioCtxRef.current = ctx
      await ctx.resume()

      wsRef.current = new WSManager(import.meta.env.VITE_WS_URL)
      wsRef.current.connect(
        () => {
          setStatus('connected')
          wsRef.current.send(
            JSON.stringify({
              event: 'start',
              start: {
                streamId: sidRef.current,
                sampleRate: TARGET_SR,
                contentType: `audio/x-l16;rate=${TARGET_SR}`,
              },
              organization_id: agentId,
            })
          )
          setStatus('recording')
        },
        onMessage,
        () => {
          setError('Connection failed')
          setStatus('error')
        },
        () => {
          setStatus('idle')
        }
      )

      const source = ctx.createMediaStreamSource(mic)
      const proc = ctx.createScriptProcessor(CHUNK_SIZE, 1, 1)

      proc.onaudioprocess = e => {
        const input = e.inputBuffer.getChannelData(0)
        let sum = 0
        for (let v of input) sum += v * v
        setRms(Math.sqrt(sum / input.length))

        const pcm = floatTo16BitPCM(input)
        wsRef.current.send(
          JSON.stringify({
            event: 'media',
            media: { payload: pcmToBase64(pcm) },
          })
        )
      }

      source.connect(proc)
      proc.connect(ctx.destination)
      procRef.current = proc
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }, [onMessage])

  // Stop capture and close connections
  const stop = useCallback(() => {
    if (currentAudioSourceRef.current) {
      try {
        currentAudioSourceRef.current.stop()
        currentAudioSourceRef.current = null
      } catch {}

    }
    audioQueueRef.current = []
    isPlayingRef.current = false
    setAgentSpeaking(false)
    nextPlayTimeRef.current = 0

    procRef.current?.disconnect()
    audioCtxRef.current?.close()
    streamRef.current?.getTracks().forEach(t => t.stop())

    wsRef.current?.send(
      JSON.stringify({
        event: 'stop',
        stop: { streamId: sidRef.current },
        organization_id: agentId,
      })
    )

    setStatus('idle')
    setRms(0)
  }, [])

  // Handle ring meter click
  const handleRingMeterClick = () => {
    if (isRecording) {
      stop()
    } else {
      start()
    }
  }

  // Cleanup handlers on unmount
  useEffect(() => {
    return () => {
      if (currentAudioSourceRef.current) {
        try {
          currentAudioSourceRef.current.stop()
        } catch {}
      }
      procRef.current?.disconnect()
      audioCtxRef.current?.close()
      streamRef.current?.getTracks().forEach(t => t.stop())
      wsRef.current?.close()
    }
  }, [])

  // Keyboard controls: space toggles start/stop, escape stops
  useEffect(() => {
    const onKey = e => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        if (status === 'recording') stop()
        else if (status === 'idle' || status === 'error') start()
      }
      if (e.code === 'Escape') {
        e.preventDefault()
        if (status !== 'idle') stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, start, stop])

  const isRecording = status === 'recording'
  const isConnected = status === 'connected' || status === 'recording'

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white text-zinc-900">
      {/* Animated background */}
      <motion.div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        animate={{
          backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        style={{
          backgroundImage: agentSpeaking
            ? 'radial-gradient(1200px 800px at 50% 50%, rgba(147,51,234,0.12), rgba(0,0,0,0))'
            : 'radial-gradient(1200px 800px at 50% 50%, rgba(59,130,246,0.12), rgba(0,0,0,0))',
          backgroundSize: '200% 200%',
        }}
      />

      <div className="relative z-10 mx-auto flex mt-6 max-w-4xl flex-col justify-center">
        <div className="w-full rounded-2xl border border-blue-200/40 bg-white/70 p-6 shadow-xl backdrop-blur-md sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mt-1 text-sm text-zinc-600">
                 Click the ring to start/stop • Space to toggle • Escape to stop
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={status} agentSpeaking={agentSpeaking} />
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-center">
            <div className="flex flex-col items-center">
              <RingMeter 
                rms={rms} 
                active={isRecording} 
                agentSpeaking={agentSpeaking} 
                onClick={handleRingMeterClick}
                isRecording={isRecording}
              />
              <AudioLevelBars rms={rms} agentSpeaking={agentSpeaking} />
              <div className="mt-4 text-sm text-zinc-600" aria-live="polite">
                {agentSpeaking && status !== 'error'
                  ? 'AI is speaking...'
                  : status === 'recording'
                  ? 'Listening for your voice...'
                  : status === 'connecting'
                  ? 'Connecting to AI...'
                  : status === 'connected'
                  ? 'Ready to listen'
                  : status === 'error'
                  ? 'Connection issue'
                  : 'Ready to start conversation'}
              </div>
              
              {/* Right-aligned control buttons */}
              <div className="mt-5 flex items-center gap-3 self-end">
                <button
                  onClick={start}
                  disabled={isRecording}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium shadow-md transition-all duration-200 active:scale-95 ${
                    isRecording
                      ? 'opacity-50 cursor-not-allowed bg-zinc-300 text-zinc-500'
                      : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-lg'
                  }`}
                >
                  <Mic className="mr-2 h-4 w-4" />
                  Start
                </button>
                <button
                  onClick={stop}
                  disabled={!isRecording && !agentSpeaking}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium shadow-md transition-all duration-200 active:scale-95 ${
                    !isRecording && !agentSpeaking
                      ? 'opacity-50 cursor-not-allowed bg-zinc-200 text-zinc-500'
                      : 'bg-rose-600 text-white hover:bg-rose-700 hover:shadow-lg'
                  }`}
                >
                  <CircleStop className="mr-2 h-4 w-4" />
                  Stop
                </button>
              </div>
              
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-3 text-sm text-rose-600 text-center"
                >
                  ❌ {error}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AgentPlayground
