import { useEffect, useRef, useState } from 'react'
import { resolveAddress, searchAddress, type ResolvedAddress } from '../../lib/address'

interface AddressAutocompleteProps {
  label?: string
  placeholder?: string
  /** 사용자가 후보를 선택해 좌표/법정동코드 변환까지 끝났을 때 호출된다. */
  onResolve: (result: ResolvedAddress) => void
  className?: string
}

const DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 2

/** 매물 탐색/주소 입력 화면에서 재사용할 주소 자동완성 입력창.
 * 타이핑 시 300ms debounce로 search-address를 호출해 후보를 보여주고, 후보 선택 시
 * resolve-address로 좌표/법정동코드까지 변환해 onResolve로 전달한다. 브이월드 API 키는
 * 두 Edge Function 안에만 있고 이 컴포넌트에는 전혀 노출되지 않는다. */
export default function AddressAutocomplete({
  label,
  placeholder = '도로명 주소를 입력하세요 (예: 서울 강남구 테헤란로 152)',
  onResolve,
  className = '',
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<string[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 응답이 요청 순서와 다르게 도착해도(느린 이전 요청이 늦게 돌아오는 경우) 최신 입력에 대한
  // 결과만 반영하기 위한 순번 가드.
  const requestIdRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setCandidates([])
      setIsOpen(false)
      setIsSearching(false)
      return
    }

    setIsSearching(true)
    const requestId = ++requestIdRef.current

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await searchAddress(trimmed)
        if (requestId !== requestIdRef.current) return
        setCandidates(result.candidates)
        setIsOpen(true)
        setError(null)
      } catch (err) {
        if (requestId !== requestIdRef.current) return
        setCandidates([])
        setError(err instanceof Error ? err.message : '주소 검색 중 오류가 발생했습니다.')
      } finally {
        if (requestId === requestIdRef.current) setIsSearching(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // 바깥 클릭 시 드롭다운 닫기.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSelect(candidate: string) {
    setQuery(candidate)
    setIsOpen(false)
    setIsResolving(true)
    setError(null)
    try {
      const resolved = await resolveAddress(candidate)
      onResolve(resolved)
    } catch (err) {
      setError(err instanceof Error ? err.message : '주소 변환 중 오류가 발생했습니다.')
    } finally {
      setIsResolving(false)
    }
  }

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {label && <label className="mb-1.5 block text-sm font-medium text-text-gray">{label}</label>}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => candidates.length > 0 && setIsOpen(true)}
        placeholder={placeholder}
        disabled={isResolving}
        className="h-[46px] w-full rounded-input border-[1.2px] border-border-input bg-white px-4 text-sm text-text-dark outline-none placeholder:text-text-lightgray focus:border-primary disabled:opacity-60"
      />

      {(isSearching || isResolving) && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-text-lightgray">
          {isResolving ? '변환 중...' : '검색 중...'}
        </span>
      )}

      {isOpen && candidates.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-input border border-border-input bg-white shadow-card">
          {candidates.map((candidate) => (
            <li key={candidate}>
              <button
                type="button"
                onClick={() => handleSelect(candidate)}
                className="block w-full px-4 py-2.5 text-left text-sm text-text-dark hover:bg-border/40"
              >
                {candidate}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-1.5 text-[11px] font-medium text-danger">{error}</p>}
    </div>
  )
}
