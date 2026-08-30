import { Chart as ChartJs, registerables, type ChartConfiguration } from 'chart.js'
import { BoxPlotController, BoxAndWiskers } from '@sgratzl/chartjs-chart-boxplot'
import { useEffect, useRef } from 'react'

ChartJs.register(...registerables, BoxPlotController, BoxAndWiskers)

interface ChartProps {
  config: ChartConfiguration
  height?: number
  ariaLabel: string
}

/**
 * Owns one Chart.js instance for the lifetime of one canvas.
 *
 * The previous version of this tool called `new Chart()` on a shared canvas for
 * every upload and never destroyed anything, so the second file thrown at it
 * died with "Canvas is already in use". Tying creation and destruction to the
 * effect makes that failure mode structurally impossible rather than something
 * to remember.
 */
export function Chart({ config, height = 260, ariaLabel }: ChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<ChartJs | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const chart = new ChartJs(canvas, config)
    chartRef.current = chart
    return () => {
      chart.destroy()
      chartRef.current = null
    }
  }, [config])

  return (
    <div style={{ height }} className="relative w-full">
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  )
}

/** Chart.js colours that track the current theme. */
export function chartColors(dark: boolean) {
  return {
    grid: dark ? 'rgba(148,163,184,0.15)' : 'rgba(100,116,139,0.15)',
    text: dark ? '#cbd5e1' : '#475569',
    series: ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#ef4444', '#14b8a6'],
  }
}

export function useIsDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}
