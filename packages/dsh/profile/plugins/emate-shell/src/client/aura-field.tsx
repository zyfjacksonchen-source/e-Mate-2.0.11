import { useEffect, useRef, useState } from 'react'
import css from './aura-field.module.css'

const DESKTOP_POINT_COUNT = 11_000
const MOBILE_POINT_COUNT = 4_200
const MORPH_CYCLE_SECONDS = 13

export function auraPointCount(width: number): number {
  return width <= 640 ? MOBILE_POINT_COUNT : DESKTOP_POINT_COUNT
}

export function auraMorphProgress(time: number): number {
  const phase = (time % MORPH_CYCLE_SECONDS) / MORPH_CYCLE_SECONDS
  let morph = 0
  if (phase < 0.10) morph = phase / 0.10
  else if (phase < 0.42) morph = 1
  else if (phase < 0.53) morph = 1 - (phase - 0.42) / 0.11
  return morph * morph * (3 - 2 * morph)
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('WebGL shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'WebGL shader compilation failed'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
  const program = gl.createProgram()
  if (program === null) throw new Error('WebGL program allocation failed')
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'WebGL program link failed'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

interface WordField {
  local: Float32Array
  count: number
  aspect: number
}

function buildWord(text: string): WordField {
  const width = 1_500
  const height = 380
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return { local: new Float32Array(), count: 0, aspect: 1 }

  context.fillStyle = '#000'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#fff'
  context.textBaseline = 'middle'
  const family = '"Helvetica Neue", Helvetica, Arial, sans-serif'
  let fontSize = 320
  let tracking = 0
  const measure = (size: number) => {
    context.font = `700 ${size}px ${family}`
    tracking = size * 0.045
    let measured = 0
    for (const character of text) measured += context.measureText(character).width + tracking
    return measured - tracking
  }
  while (fontSize > 40 && measure(fontSize) > width - 110) fontSize -= 6
  const total = measure(fontSize)
  context.font = `700 ${fontSize}px ${family}`
  let cursor = (width - total) / 2
  for (const character of text) {
    context.fillText(character, cursor, height / 2)
    cursor += context.measureText(character).width + tracking
  }

  const pixels = context.getImageData(0, 0, width, height).data
  const points: number[] = []
  let minimumX = width
  let maximumX = 0
  let minimumY = height
  let maximumY = 0
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      if (pixels[(y * width + x) * 4] <= 128) continue
      points.push(x, y)
      minimumX = Math.min(minimumX, x)
      maximumX = Math.max(maximumX, x)
      minimumY = Math.min(minimumY, y)
      maximumY = Math.max(maximumY, y)
    }
  }
  if (points.length === 0) return { local: new Float32Array(), count: 0, aspect: 1 }
  const centerX = (minimumX + maximumX) / 2
  const centerY = (minimumY + maximumY) / 2
  const pixelHeight = Math.max(1, maximumY - minimumY)
  const local = new Float32Array(points.length)
  for (let index = 0; index < points.length; index += 2) {
    local[index] = (points[index] - centerX) / pixelHeight
    local[index + 1] = (centerY - points[index + 1]) / pixelHeight
  }
  return { local, count: points.length / 2, aspect: (maximumX - minimumX) / pixelHeight }
}

function buildParticleFields(count: number, word: WordField) {
  const order = new Int32Array(word.count)
  for (let index = 0; index < word.count; index += 1) order[index] = index
  let seed = 9176
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff
    return seed / 0x7fff_ffff
  }
  for (let index = word.count - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const value = order[index]
    order[index] = order[swap]
    order[swap] = value
  }

  const form = new Float32Array(count * 3)
  const wordmark = new Float32Array(count * 3)
  const randomness = new Float32Array(count * 3)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let point = 0; point < count; point += 1) {
    const progress = point / Math.max(1, count - 1)
    const y = 1 - progress * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const angle = goldenAngle * point
    const sphereX = Math.cos(angle) * radius
    const sphereZ = Math.sin(angle) * radius
    const surfaceRadius = 1 + 0.20 * Math.sin(y * 3 + angle) + 0.13 * Math.cos(angle * 2 - y * 2)
    const twist = y * 0.6
    const cosine = Math.cos(twist)
    const sine = Math.sin(twist)
    form[point * 3] = (sphereX * cosine - sphereZ * sine) * surfaceRadius
    form[point * 3 + 1] = y * surfaceRadius * 0.92
    form[point * 3 + 2] = (sphereX * sine + sphereZ * cosine) * surfaceRadius

    const wordIndex = order[point % Math.max(1, word.count)] ?? 0
    wordmark[point * 3] = (word.local[wordIndex * 2] ?? 0) + (random() - 0.5) * 0.012
    wordmark[point * 3 + 1] = (word.local[wordIndex * 2 + 1] ?? 0) + (random() - 0.5) * 0.012
    wordmark[point * 3 + 2] = (random() - 0.5) * 0.03
    randomness[point * 3] = random()
    randomness[point * 3 + 1] = random()
    randomness[point * 3 + 2] = random()
  }
  return { form, wordmark, randomness }
}

const VERTEX_SHADER = `
precision highp float;
attribute vec3 a_form;
attribute vec3 a_wordmark;
attribute vec3 a_random;
uniform float u_time;
uniform float u_morph;
uniform mat3 u_rotation;
uniform float u_form_scale;
uniform vec3 u_form_offset;
uniform float u_word_height;
uniform vec2 u_word_offset;
uniform float u_aspect;
uniform vec2 u_pointer;
uniform float u_pointer_on;
uniform float u_drift;
uniform float u_point_size;
varying float v_mix;
varying float v_depth;
varying float v_seed;

void main() {
  float mixValue = clamp(u_morph * 1.35 - a_random.x * 0.35, 0.0, 1.0);
  mixValue = mixValue * mixValue * (3.0 - 2.0 * mixValue);
  vec3 fieldPosition = u_rotation * (a_form * u_form_scale) + u_form_offset;
  vec3 wordPosition = vec3(a_wordmark.xy * u_word_height + u_word_offset, a_wordmark.z);
  vec3 position = mix(fieldPosition, wordPosition, mixValue);
  float drift = u_drift * mix(1.0, 0.18, mixValue);
  vec3 disturbance = vec3(
    sin(position.y * 1.7 + u_time * 0.9 + a_random.z * 6.2831) + sin(position.z * 1.3 - u_time * 0.7),
    sin(position.z * 1.9 + u_time * 1.1) + sin(position.x * 1.2 + u_time * 0.6 + a_random.z * 6.2831),
    sin(position.x * 1.5 - u_time * 0.8) + sin(position.y * 1.4 + u_time * 0.7)
  );
  position += disturbance * drift;
  vec2 pointerDelta = position.xy - u_pointer;
  float pointerDistance = length(pointerDelta);
  float pointerPush = u_pointer_on * 0.16 / (pointerDistance * pointerDistance + 0.02);
  pointerPush = min(pointerPush, 0.32);
  position.xy += (pointerDelta / (pointerDistance + 0.0001)) * pointerPush * (1.0 - mixValue * 0.45);
  gl_Position = vec4(position.x / u_aspect, position.y, position.z * 0.15, 1.0);
  float pointSize = u_point_size * (0.62 + a_random.y * 0.7) * (1.0 + position.z * 0.28);
  pointSize *= mix(1.0, 0.85, mixValue);
  gl_PointSize = clamp(pointSize, 1.0, 15.0);
  v_mix = mixValue;
  v_depth = position.z;
  v_seed = a_random.y;
}
`

const FRAGMENT_SHADER = `
precision highp float;
uniform float u_exposure;
varying float v_mix;
varying float v_depth;
varying float v_seed;

void main() {
  vec2 point = gl_PointCoord - 0.5;
  float radius = length(point);
  float soft = smoothstep(0.5, 0.0, radius);
  float core = pow(soft, 3.5);
  float alpha = soft * 0.42 + core * 0.65;
  vec3 fieldColor = vec3(0.5, 0.5, 0.5);
  vec3 wordColor = vec3(1.0, 0.33, 0.07);
  vec3 color = mix(fieldColor, wordColor, v_mix);
  float depthBrightness = 0.55 + 0.45 * smoothstep(-1.1, 1.1, v_depth);
  color *= mix(depthBrightness, 1.0, v_mix);
  color += vec3(0.08) * (1.0 - v_mix) * soft;
  color += vec3(0.04) * core * v_mix;
  alpha *= mix(0.9, 1.0, v_seed);
  gl_FragColor = vec4(color * u_exposure * alpha, alpha);
}
`

type RendererState = 'pending' | 'webgl' | 'fallback'

export function AuraField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const statusRef = useRef<HTMLSpanElement>(null)
  const telemetryRef = useRef<HTMLDivElement>(null)
  const [renderer, setRenderer] = useState<RendererState>('pending')
  const [pointCount, setPointCount] = useState(() => auraPointCount(window.innerWidth))

  useEffect(() => {
    const canvas = canvasRef.current
    const stage = canvas?.parentElement
    if (canvas === null || stage === null || stage === undefined || typeof window.WebGLRenderingContext === 'undefined') {
      setRenderer('fallback')
      return undefined
    }
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    if (gl === null) {
      setRenderer('fallback')
      return undefined
    }

    let vertexShader: WebGLShader | null = null
    let fragmentShader: WebGLShader | null = null
    let program: WebGLProgram | null = null
    const buffers: WebGLBuffer[] = []
    let frame = 0
    let stopped = false
    let hidden = document.hidden
    let aspect = 1
    let pointerTargetX = 99
    let pointerTargetY = 99
    let pointerX = 99
    let pointerY = 99
    let pointerOn = 0
    let pointerOnTarget = 0
    let lastPointerMove = -9_999
    let telemetryTick = 0
    let lastStatus = ''
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const mobile = matchMedia('(max-width: 640px)').matches
    const count = auraPointCount(innerWidth)
    const renderScale = mobile ? 0.5 : 0.66
    const pointSize = mobile ? 3.1 : 3.5
    setPointCount(count)

    try {
      vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
      fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
      program = createProgram(gl, vertexShader, fragmentShader)
      gl.useProgram(program)
      const word = buildWord('e-Mate')
      const positions = buildParticleFields(count, word)

      const bindAttribute = (name: string, values: Float32Array) => {
        const location = gl.getAttribLocation(program as WebGLProgram, name)
        if (location < 0) throw new Error(`WebGL attribute ${name} is unavailable`)
        const buffer = gl.createBuffer()
        if (buffer === null) throw new Error(`WebGL buffer ${name} allocation failed`)
        buffers.push(buffer)
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW)
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0)
      }
      bindAttribute('a_form', positions.form)
      bindAttribute('a_wordmark', positions.wordmark)
      bindAttribute('a_random', positions.randomness)

      const uniforms = Object.fromEntries([
        'u_time', 'u_morph', 'u_rotation', 'u_form_scale', 'u_form_offset', 'u_word_height',
        'u_word_offset', 'u_aspect', 'u_pointer', 'u_pointer_on', 'u_drift', 'u_point_size', 'u_exposure',
      ].map(name => [name, gl.getUniformLocation(program as WebGLProgram, name)])) as Record<string, WebGLUniformLocation | null>
      if (Object.values(uniforms).some(value => value === null)) throw new Error('WebGL uniform contract changed')

      gl.disable(gl.DEPTH_TEST)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.clearColor(0, 0, 0, 0)
      gl.uniform1f(uniforms.u_exposure, 0.92)
      gl.uniform1f(uniforms.u_drift, mobile ? 0.04 : 0.05)

      const rotation = new Float32Array(9)
      const setRotation = (xAngle: number, yAngle: number) => {
        const cosineX = Math.cos(xAngle)
        const sineX = Math.sin(xAngle)
        const cosineY = Math.cos(yAngle)
        const sineY = Math.sin(yAngle)
        rotation[0] = cosineY
        rotation[1] = 0
        rotation[2] = -sineY
        rotation[3] = sineY * sineX
        rotation[4] = cosineX
        rotation[5] = cosineY * sineX
        rotation[6] = sineY * cosineX
        rotation[7] = -sineX
        rotation[8] = cosineY * cosineX
        gl.uniformMatrix3fv(uniforms.u_rotation, false, rotation)
      }

      const layout = () => {
        aspect = stage.clientWidth / Math.max(1, stage.clientHeight)
        const narrow = stage.clientWidth <= 640
        const leftMargin = narrow ? 0.07 : 0.14
        const widthFraction = narrow ? 0.74 : 0.46
        const maximumWordHeight = narrow ? 0.18 : 0.32
        const targetWidth = Math.min(2 * aspect * widthFraction, 2 * aspect - leftMargin * 2)
        const wordHeight = Math.min(maximumWordHeight, targetWidth / Math.max(0.01, word.aspect))
        const halfWordWidth = 0.5 * wordHeight * word.aspect
        gl.uniform1f(uniforms.u_word_height, wordHeight)
        gl.uniform2f(uniforms.u_word_offset, -aspect + leftMargin + halfWordWidth, narrow ? -0.74 : -0.36)
        gl.uniform1f(uniforms.u_form_scale, narrow ? 0.44 : 0.62)
        gl.uniform3f(uniforms.u_form_offset, narrow ? 0 : aspect * 0.34, narrow ? 0.34 : 0.18, 0)
        gl.uniform1f(uniforms.u_aspect, aspect)
        gl.uniform1f(uniforms.u_point_size, pointSize * renderScale)
      }

      const resize = () => {
        const width = Math.max(1, Math.floor(stage.clientWidth * renderScale))
        const height = Math.max(1, Math.floor(stage.clientHeight * renderScale))
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width
          canvas.height = height
        }
        gl.viewport(0, 0, canvas.width, canvas.height)
        layout()
      }

      const updatePointer = (event: PointerEvent) => {
        pointerTargetX = (event.clientX / Math.max(1, innerWidth) * 2 - 1) * aspect
        pointerTargetY = -(event.clientY / Math.max(1, innerHeight) * 2 - 1)
        pointerOnTarget = 1
        lastPointerMove = performance.now()
      }
      const updateVisibility = () => { hidden = document.hidden }
      const startedAt = performance.now()
      const render = (now: number) => {
        if (stopped) return
        if (!hidden) {
          const time = (now - startedAt) / 1_000
          const morph = reducedMotion ? 1 : auraMorphProgress(time)
          pointerX += (pointerTargetX - pointerX) * 0.12
          pointerY += (pointerTargetY - pointerY) * 0.12
          if (now - lastPointerMove > 1_400) pointerOnTarget = 0
          pointerOn += (pointerOnTarget - pointerOn) * 0.08
          const yAngle = time * 0.13
          setRotation(0.30 * Math.sin(time * 0.09) + 0.16, yAngle)
          gl.uniform1f(uniforms.u_time, time)
          gl.uniform1f(uniforms.u_morph, morph)
          gl.uniform2f(uniforms.u_pointer, pointerX, pointerY)
          gl.uniform1f(uniforms.u_pointer_on, pointerOn)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.drawArrays(gl.POINTS, 0, count)

          const status = morph > 0.82 ? '已聚合' : morph < 0.04 ? '漂移中' : '聚合中'
          if (status !== lastStatus) {
            lastStatus = status
            if (statusRef.current !== null) statusRef.current.textContent = status
          }
          telemetryTick = (telemetryTick + 1) % 8
          if (telemetryTick === 0 && telemetryRef.current !== null) {
            telemetryRef.current.textContent = `θ ${(yAngle % (Math.PI * 2)).toFixed(2)} · ${count.toLocaleString('en-US')} N`
          }
        }
        if (!reducedMotion) frame = requestAnimationFrame(render)
      }

      addEventListener('resize', resize)
      if (!reducedMotion) addEventListener('pointermove', updatePointer, { passive: true })
      document.addEventListener('visibilitychange', updateVisibility)
      resize()
      render(reducedMotion ? startedAt + 4_000 : performance.now())
      setRenderer('webgl')

      return () => {
        stopped = true
        cancelAnimationFrame(frame)
        removeEventListener('resize', resize)
        removeEventListener('pointermove', updatePointer)
        document.removeEventListener('visibilitychange', updateVisibility)
        for (const buffer of buffers) gl.deleteBuffer(buffer)
        if (program !== null) gl.deleteProgram(program)
        if (vertexShader !== null) gl.deleteShader(vertexShader)
        if (fragmentShader !== null) gl.deleteShader(fragmentShader)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
    } catch {
      for (const buffer of buffers) gl.deleteBuffer(buffer)
      if (program !== null) gl.deleteProgram(program)
      if (vertexShader !== null) gl.deleteShader(vertexShader)
      if (fragmentShader !== null) gl.deleteShader(fragmentShader)
      setRenderer('fallback')
      return undefined
    }
  }, [])

  return (
    <div className={css.root} data-aura-field data-aura-renderer={renderer} aria-hidden="true">
      <canvas ref={canvasRef} className={css.canvas} />
      <div className={css.fallbackWord}>e-Mate</div>
      <div className={css.status}>2.0.12 · {pointCount.toLocaleString('en-US')} PTS · <span ref={statusRef}>漂移中</span></div>
      <div ref={telemetryRef} className={css.telemetry}>θ 0.00 · {pointCount.toLocaleString('en-US')} N</div>
    </div>
  )
}
