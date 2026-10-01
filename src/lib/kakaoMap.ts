/** 카카오맵 SDK를 한 번만 로드한다(이미 로드됐거나 로드 중이면 재사용). SignalMap과
 * PropertyMiniMap이 공유한다 — 원래 SignalMap.tsx에만 있던 걸 중복 피하려고 옮겼다. */
export function loadKakaoSdk(appKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.kakao?.maps) {
      resolve()
      return
    }

    const existing = document.getElementById('kakao-maps-sdk') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('load', () => window.kakao.maps.load(resolve))
      existing.addEventListener('error', () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다.')))
      return
    }

    const script = document.createElement('script')
    script.id = 'kakao-maps-sdk'
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`
    script.onload = () => window.kakao.maps.load(resolve)
    script.onerror = () => reject(new Error('카카오맵 SDK를 불러오지 못했습니다.'))
    document.head.appendChild(script)
  })
}
