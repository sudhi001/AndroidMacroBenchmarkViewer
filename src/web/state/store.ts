import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { DEFAULT_COMPARE_OPTIONS, type CompareOptions } from '../../core/compare'
import type { BenchmarkRun } from '../../core/types'

export type View = 'single' | 'compare' | 'trend'
export type Theme = 'light' | 'dark' | 'system'

export interface LoadError {
  label: string
  message: string
}

export interface AppState {
  runs: BenchmarkRun[]
  errors: LoadError[]
  view: View
  selectedRunId: string | null
  baselineId: string | null
  candidateId: string | null
  compareOptions: CompareOptions
  theme: Theme
}

export type Action =
  | { type: 'runs/add'; runs: BenchmarkRun[] }
  | { type: 'runs/remove'; id: string }
  | { type: 'runs/rename'; id: string; label: string }
  | { type: 'runs/clear' }
  | { type: 'errors/set'; errors: LoadError[] }
  | { type: 'errors/dismiss' }
  | { type: 'view/set'; view: View }
  | { type: 'select/run'; id: string }
  | { type: 'select/baseline'; id: string }
  | { type: 'select/candidate'; id: string }
  | { type: 'compare/options'; options: Partial<CompareOptions> }
  | { type: 'theme/set'; theme: Theme }

const OPTIONS_KEY = 'amv.compareOptions'
const THEME_KEY = 'amv.theme'

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : ({ ...fallback, ...JSON.parse(raw) } as T)
  } catch {
    return fallback
  }
}

function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
  } catch {
    return 'system'
  }
}

export const initialState: AppState = {
  runs: [],
  errors: [],
  view: 'single',
  selectedRunId: null,
  baselineId: null,
  candidateId: null,
  compareOptions: readStored(OPTIONS_KEY, DEFAULT_COMPARE_OPTIONS),
  theme: readTheme(),
}

/**
 * Keep the three run selections pointing at runs that still exist, and fill
 * them in as runs arrive so the compare and trend views are usable the moment
 * a second file lands rather than requiring three separate picks.
 */
function reconcileSelection(state: AppState): AppState {
  const ids = state.runs.map((r) => r.id)
  const has = (id: string | null) => id !== null && ids.includes(id)

  const selectedRunId = has(state.selectedRunId) ? state.selectedRunId : (ids[0] ?? null)
  let baselineId = has(state.baselineId) ? state.baselineId : (ids[0] ?? null)
  let candidateId = has(state.candidateId) ? state.candidateId : null

  if (candidateId === null || candidateId === baselineId) {
    // Default to the two most recently captured runs, oldest as the baseline.
    const byTime = [...state.runs].sort((a, b) => a.capturedAt - b.capturedAt)
    if (byTime.length >= 2) {
      baselineId = byTime[byTime.length - 2]!.id
      candidateId = byTime[byTime.length - 1]!.id
    } else {
      candidateId = null
    }
  }

  return { ...state, selectedRunId, baselineId, candidateId }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'runs/add': {
      // Re-dropping the same file replaces it rather than stacking duplicates.
      const incoming = new Map(action.runs.map((r) => [r.id, r]))
      const kept = state.runs.filter((r) => !incoming.has(r.id))
      return reconcileSelection({ ...state, runs: [...kept, ...action.runs], errors: [] })
    }
    case 'runs/remove':
      return reconcileSelection({
        ...state,
        runs: state.runs.filter((r) => r.id !== action.id),
      })
    case 'runs/rename':
      return {
        ...state,
        runs: state.runs.map((r) => (r.id === action.id ? { ...r, label: action.label } : r)),
      }
    case 'runs/clear':
      return reconcileSelection({ ...state, runs: [], errors: [] })
    case 'errors/set':
      return { ...state, errors: action.errors }
    case 'errors/dismiss':
      return { ...state, errors: [] }
    case 'view/set':
      return { ...state, view: action.view }
    case 'select/run':
      return { ...state, selectedRunId: action.id }
    case 'select/baseline':
      return {
        ...state,
        baselineId: action.id,
        // Never let both sides point at the same run through the pickers.
        candidateId: state.candidateId === action.id ? state.baselineId : state.candidateId,
      }
    case 'select/candidate':
      return {
        ...state,
        candidateId: action.id,
        baselineId: state.baselineId === action.id ? state.candidateId : state.baselineId,
      }
    case 'compare/options': {
      const compareOptions = { ...state.compareOptions, ...action.options }
      try {
        localStorage.setItem(OPTIONS_KEY, JSON.stringify(compareOptions))
      } catch {
        // Private browsing or a full quota: thresholds simply do not persist.
      }
      return { ...state, compareOptions }
    }
    case 'theme/set':
      try {
        localStorage.setItem(THEME_KEY, action.theme)
      } catch {
        // As above.
      }
      return { ...state, theme: action.theme }
    default:
      return state
  }
}

interface Store {
  state: AppState
  dispatch: Dispatch<Action>
}

const AppContext = createContext<Store | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = state.theme === 'dark' || (state.theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (state.theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [state.theme])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return createElement(AppContext.Provider, { value }, children)
}

export function useStore(): Store {
  const store = useContext(AppContext)
  if (!store) throw new Error('useStore must be used inside AppProvider')
  return store
}

export function useRun(id: string | null): BenchmarkRun | null {
  const { state } = useStore()
  return state.runs.find((r) => r.id === id) ?? null
}
