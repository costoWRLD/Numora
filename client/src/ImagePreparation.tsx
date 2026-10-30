import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { CV } from '@techstark/opencv-js'
import './ImagePreparation.css'

type Crop = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type OpenCv = CV & { onRuntimeInitialized?: () => void }

let openCvPromise: Promise<OpenCv> | undefined

function getOpenCv(): Promise<OpenCv> {
  if (!openCvPromise) {
    openCvPromise = import('@techstark/opencv-js').then(async (module) => {
      const candidate = (module as unknown as { default?: OpenCv | Promise<OpenCv> }).default || module
      // @techstark/opencv-js exports a Promise in browser builds; awaiting it
      // is what waits for the WASM runtime to finish initializing.
      const runtime = await Promise.resolve(candidate) as unknown as OpenCv
      if (runtime.Mat) return runtime
      return new Promise<OpenCv>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('OpenCV did not finish loading. Try again.')), 60000)
        const previous = runtime.onRuntimeInitialized
        runtime.onRuntimeInitialized = () => {
          window.clearTimeout(timeout)
          previous?.()
          resolve(runtime)
        }
      })
    }).catch((error: unknown) => {
      openCvPromise = undefined
      throw error
    })
  }
  return openCvPromise
}

const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

export type ImagePreparationHandle = {
  prepare: () => Promise<File>
  prepareContrast: () => Promise<File>
  prepareFocusedCrops: (areas: ImageFocusArea[]) => Promise<PreparedFocusCrop[]>
}

export type ImageFocusArea = { x: number; y: number; width: number; height: number; scale: number }
export type PreparedFocusCrop = ImageFocusArea & { imageBase64: string }

type Props = { file: File }

const ImagePreparation = forwardRef<ImagePreparationHandle, Props>(function ImagePreparation({ file }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cropStartRef = useRef<{ x: number; y: number } | null>(null)
  const activeCornerRef = useRef<number | null>(null)
  const preparedCacheRef = useRef<{ key: string; file: File } | null>(null)
  const [rotation, setRotation] = useState(0)
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, width: 1, height: 1 })
  const [corners, setCorners] = useState<Point[]>([])
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 })
  const [error, setError] = useState('')

  useEffect(() => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight))
      const sourceWidth = Math.max(1, Math.round(image.naturalWidth * scale))
      const sourceHeight = Math.max(1, Math.round(image.naturalHeight * scale))
      const width = rotation % 180 === 0 ? sourceWidth : sourceHeight
      const height = rotation % 180 === 0 ? sourceHeight : sourceWidth
      const canvas = canvasRef.current
      const context = canvas?.getContext('2d')
      if (!canvas || !context) return
      canvas.width = width
      canvas.height = height
      setCanvasSize({ width, height })
      context.save()
      if (rotation === 90) { context.translate(width, 0); context.rotate(Math.PI / 2) }
      else if (rotation === 180) { context.translate(width, height); context.rotate(Math.PI) }
      else if (rotation === 270) { context.translate(0, height); context.rotate(-Math.PI / 2) }
      context.drawImage(image, 0, 0, sourceWidth, sourceHeight)
      context.restore()
      setCrop({ x: 0, y: 0, width, height })
      setCorners([{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }])
      setError('')
    }
    image.onerror = () => setError('Could not prepare this image. Try another JPG, PNG, or WebP file.')
    image.src = url
    return () => { URL.revokeObjectURL(url) }
  }, [file, rotation])

  useImperativeHandle(ref, () => {
    const prepare = async () => {
      const source = canvasRef.current
      if (!source || !crop.width || !crop.height || corners.length !== 4) throw new Error('Choose a usable crop before reading the receipt.')
      const cacheKey = `${file.name}:${file.lastModified}:${rotation}:${corners.map(({ x, y }) => `${x},${y}`).join(';')}`
      if (preparedCacheRef.current?.key === cacheKey) return preparedCacheRef.current.file
      const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      const turns = corners.map((point, index) => cross(point, corners[(index + 1) % 4], corners[(index + 2) % 4]))
      if (turns.some((turn) => Math.abs(turn) < 20) || !(turns.every((turn) => turn > 0) || turns.every((turn) => turn < 0))) {
        throw new Error('The four corners overlap or form an invalid shape. Adjust them so they follow the receipt edges.')
      }
      const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
      const outputWidth = Math.max(1, Math.round((distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2))
      const outputHeight = Math.max(1, Math.round((distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2))
      if (outputWidth < 80 || outputHeight < 80) throw new Error('The selected receipt area is too small. Widen the crop and try again.')

      const cv = await getOpenCv()
      const input = cv.matFromImageData(source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height))
      const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(({ x, y }) => [x, y]))
      const destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1])
      const transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints)
      const warped = new cv.Mat()
      try {
        cv.warpPerspective(input, warped, transform, new cv.Size(outputWidth, outputHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE)
        const output = document.createElement('canvas')
        output.width = outputWidth
        output.height = outputHeight
        const context = output.getContext('2d')
        if (!context) throw new Error('Could not prepare the receipt image.')
        const pixels = new Uint8ClampedArray(warped.data)
        context.putImageData(new ImageData(pixels, outputWidth, outputHeight), 0, 0)
        const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((result) => result ? resolve(result) : reject(new Error('Could not encode the prepared image.')), 'image/jpeg', 0.94))
        const preparedFile = new File([blob], `prepared-${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
        preparedCacheRef.current = { key: cacheKey, file: preparedFile }
        return preparedFile
      } finally {
        input.delete()
        sourcePoints.delete()
        destinationPoints.delete()
        transform.delete()
        warped.delete()
      }
    }
    return {
      prepare,
      prepareContrast: async () => {
        const prepared = await prepare()
        const bitmap = await createImageBitmap(prepared)
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) { bitmap.close(); throw new Error('Could not create the contrast retry image.') }
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const cv = await getOpenCv()
        const input = cv.imread(canvas)
        const gray = new cv.Mat()
        const equalized = new cv.Mat()
        const rgba = new cv.Mat()
        try {
          cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY)
          cv.equalizeHist(gray, equalized)
          cv.cvtColor(equalized, rgba, cv.COLOR_GRAY2RGBA)
          cv.imshow(canvas, rgba)
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not encode the contrast retry image.')), 'image/jpeg', 0.94))
          return new File([blob], `contrast-${prepared.name}`, { type: 'image/jpeg' })
        } finally {
          input.delete()
          gray.delete()
          equalized.delete()
          rgba.delete()
        }
      },
      prepareFocusedCrops: async (areas) => {
        const prepared = await prepare()
        const bitmap = await createImageBitmap(prepared)
        try {
          return areas.slice(0, 4).flatMap((area) => {
            const x = Math.max(0, Math.min(bitmap.width - 1, Math.floor(area.x)))
            const y = Math.max(0, Math.min(bitmap.height - 1, Math.floor(area.y)))
            const width = Math.max(1, Math.min(bitmap.width - x, Math.ceil(area.width)))
            const height = Math.max(1, Math.min(bitmap.height - y, Math.ceil(area.height)))
            const scale = Math.max(1, Math.min(3, Number(area.scale) || 2))
            const output = document.createElement('canvas')
            output.width = Math.max(1, Math.round(width * scale))
            output.height = Math.max(1, Math.round(height * scale))
            const context = output.getContext('2d')
            if (!context) return []
            context.imageSmoothingEnabled = true
            context.imageSmoothingQuality = 'high'
            context.drawImage(bitmap, x, y, width, height, 0, 0, output.width, output.height)
            const dataUrl = output.toDataURL('image/jpeg', 0.96)
            return [{ x, y, width, height, scale, imageBase64: dataUrl.slice(dataUrl.indexOf(',') + 1) }]
          })
        } finally {
          bitmap.close()
        }
      },
    }
  }, [canvasSize, corners, crop, file, rotation])

  function pointerPoint(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvasSize.width - 1, (event.clientX - bounds.left) * canvasSize.width / bounds.width)),
      y: Math.max(0, Math.min(canvasSize.height - 1, (event.clientY - bounds.top) * canvasSize.height / bounds.height)),
    }
  }

  function startCrop(event: PointerEvent<HTMLDivElement>) {
    const point = pointerPoint(event)
    const cornerIndex = (event.target as HTMLElement).closest<HTMLElement>('[data-corner]')?.dataset.corner
    if (cornerIndex !== undefined) {
      activeCornerRef.current = Number(cornerIndex)
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }
    cropStartRef.current = point
    setCrop({ x: point.x, y: point.y, width: 1, height: 1 })
    setCorners([{ x: point.x, y: point.y }, { x: point.x, y: point.y }, { x: point.x, y: point.y }, { x: point.x, y: point.y }])
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveCrop(event: PointerEvent<HTMLDivElement>) {
    if (activeCornerRef.current !== null) {
      const index = activeCornerRef.current
      const point = pointerPoint(event)
      setCorners((current) => current.map((corner, cornerIndex) => cornerIndex === index ? point : corner))
      return
    }
    const start = cropStartRef.current
    if (!start) return
    const point = pointerPoint(event)
    const nextCrop = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) }
    setCrop(nextCrop)
    setCorners([{ x: nextCrop.x, y: nextCrop.y }, { x: nextCrop.x + nextCrop.width, y: nextCrop.y }, { x: nextCrop.x + nextCrop.width, y: nextCrop.y + nextCrop.height }, { x: nextCrop.x, y: nextCrop.y + nextCrop.height }])
  }

  function endCrop() {
    if (activeCornerRef.current !== null) {
      activeCornerRef.current = null
      return
    }
    const start = cropStartRef.current
    if (start && (crop.width < 24 || crop.height < 24)) {
      setCrop({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height })
      setCorners([{ x: 0, y: 0 }, { x: canvasSize.width - 1, y: 0 }, { x: canvasSize.width - 1, y: canvasSize.height - 1 }, { x: 0, y: canvasSize.height - 1 }])
    }
    cropStartRef.current = null
  }

  function rotate(degrees: number) {
    setRotation((current) => (current + degrees + 360) % 360)
  }

  function resetCrop() {
    setCrop({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height })
    setCorners([{ x: 0, y: 0 }, { x: canvasSize.width - 1, y: 0 }, { x: canvasSize.width - 1, y: canvasSize.height - 1 }, { x: 0, y: canvasSize.height - 1 }])
  }

  function moveCornerWithKeyboard(index: number, event: KeyboardEvent<HTMLButtonElement>) {
    const deltas: Record<string, Point> = { ArrowUp: { x: 0, y: -4 }, ArrowDown: { x: 0, y: 4 }, ArrowLeft: { x: -4, y: 0 }, ArrowRight: { x: 4, y: 0 } }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    setCorners((current) => current.map((point, pointIndex) => pointIndex === index ? {
      x: Math.max(crop.x, Math.min(crop.x + crop.width, point.x + delta.x)),
      y: Math.max(crop.y, Math.min(crop.y + crop.height, point.y + delta.y)),
    } : point))
  }

  return <section className="image-preparation" aria-label="Prepare receipt image">
    <div className="preparation-heading"><strong>Prepare image for OCR</strong><span>Drag a crop, then move the four corner handles onto the receipt edges. OpenCV will flatten the selected area. The original photo is kept for saving.</span></div>
    <div className="preparation-preview">
      <canvas ref={canvasRef} aria-label="Rotated receipt image preview" />
      <div className="crop-overlay" onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={endCrop} onPointerCancel={endCrop}>
        {corners.length === 4 && <svg className="perspective-guides" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none" aria-hidden="true"><polygon points={corners.map(({ x, y }) => `${x},${y}`).join(' ')} /></svg>}
        {corners.map((corner, index) => <button key={CORNER_NAMES[index]} className="perspective-handle" type="button" data-corner={index} style={{ left: `${corner.x / canvasSize.width * 100}%`, top: `${corner.y / canvasSize.height * 100}%` }} aria-label={`Move ${CORNER_NAMES[index]} perspective corner`} onKeyDown={(event) => moveCornerWithKeyboard(index, event)} />)}
      </div>
    </div>
    <div className="preparation-actions">
      <button type="button" onClick={() => rotate(-90)} aria-label="Rotate image left">↶ Rotate left</button>
      <button type="button" onClick={() => rotate(90)} aria-label="Rotate image right">↷ Rotate right</button>
      <button type="button" onClick={resetCrop}>Reset crop</button>
      <span>{Math.round(crop.width)} × {Math.round(crop.height)} px crop · adjust corners</span>
    </div>
    {error && <p className="preparation-error" role="alert">{error}</p>}
  </section>
})

export default ImagePreparation
