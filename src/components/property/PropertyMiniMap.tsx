import { useEffect, useRef, useState } from 'react'
import { loadKakaoSdk } from '../../lib/kakaoMap'

interface PropertyMiniMapProps {
  lat: number
  lng: number
}

/** 매물 탐색 리포트의 "위치" 섹션에 쓰는 단일 마커 지도. SignalMap의 전국 폴리곤 지도와 달리
 * 여기는 한 점만 찍어서 보여주면 되므로 훨씬 가볍다. */
export default function PropertyMiniMap({ lat, lng }: PropertyMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const appKey = import.meta.env.VITE_KAKAO_MAP_KEY
    if (!appKey) {
      setError('카카오맵 API 키가 설정되지 않았어요.')
      return
    }

    let cancelled = false

    loadKakaoSdk(appKey)
      .then(() => {
        if (cancelled || !containerRef.current) return
        const center = new window.kakao.maps.LatLng(lat, lng)
        const map = new window.kakao.maps.Map(containerRef.current, { center, level: 4 })
        new window.kakao.maps.Marker({ position: center, map })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '지도를 불러오지 못했습니다.')
      })

    return () => {
      cancelled = true
    }
  }, [lat, lng])

  if (error) {
    return <p className="rounded-input bg-subtle p-4 text-center text-xs text-text-gray">{error}</p>
  }

  return <div ref={containerRef} className="h-[200px] w-full rounded-input" />
}
