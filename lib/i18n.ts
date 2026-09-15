/**
 * The swap flow in Korean, Spanish and Vietnamese, besides English.
 *
 * The English sentence is the key, so a string with no translation yet still
 * reads in English, and a translation can never drift from what it
 * translates without the key changing with it. `{name}` marks a value put in
 * at runtime. Covered: the tabs, the wallet, the token picker, the swap panel
 * and the errors a swap most often ends in. Pages beyond the swap stay in
 * English. Nothing here may promise a return; the copy rules hold in every
 * language.
 *
 * The language is picked once from ?lang=, a choice made before, or the
 * browser's own languages, and changed from the footer or search.
 */

import { useEffect, useState } from 'react'

export type Lang = 'en' | 'ko' | 'es' | 'vi'
export const LANGS: { code: Lang; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'vi', name: 'Tiếng Việt' },
]

type Dict = Record<string, string>

const ko: Dict = {
  'Swap': '스왑',
  'Pools': '풀',
  'Bridge': '브리지',
  'Portfolio': '포트폴리오',
  'Board': '순위표',
  'Search': '검색',
  'Experimental': '실험 중',
  'TerraLuna apps': 'TerraLuna 앱',
  'Swap tokens, pools, liquidity, transfers': '토큰 스왑, 풀, 유동성, 전송',
  'Collections, items, listings and offers': '컬렉션, 아이템, 판매 등록과 제안',
  'Proposals, votes and the community pool': '제안, 투표와 커뮤니티 풀',
  'here': '현재',
  'All apps at terraluna.app': 'terraluna.app에서 모든 앱 보기',
  'Language': '언어',
  'Connect': '지갑 연결',
  'Connect a wallet': '지갑 연결',
  'Terra, phoenix-1. Nothing is stored; the wallet signs, the chain does the rest.': '테라 phoenix-1. 아무것도 저장하지 않습니다. 서명은 지갑이, 나머지는 체인이 합니다.',
  'Browse-only': '보기 전용',
  'Best route on Terra · no interface fee': '테라 최적 경로 · 인터페이스 수수료 없음',
  'You pay': '지불',
  'You receive': '수령',
  'Balance': '잔액',
  'max': '최대',
  'or type what you want to receive': '또는 받고 싶은 수량을 입력하세요',
  'Route': '경로',
  'Split over two paths that share no pool': '풀이 겹치지 않는 두 경로로 분할',
  'vs one path': '단일 경로 대비',
  '+{pct}% more {token}': '{token} +{pct}% 더',
  'vs {venue} alone': '{venue}만 사용할 때 대비',
  'Rate': '교환 비율',
  'Price impact': '가격 영향',
  'Pool fee': '풀 수수료',
  'Pool fees': '풀 수수료',
  'Min. received ({pct}% slippage)': '최소 수령량 (슬리피지 {pct}%)',
  'Min. received ({pct}% slippage, auto)': '최소 수령량 (슬리피지 {pct}%, 자동)',
  'Min. received ({pct}% per leg)': '최소 수령량 (구간별 {pct}%)',
  'Network fee': '네트워크 수수료',
  'You receive at least': '최소 수령',
  'Slippage': '슬리피지',
  'Auto': '자동',
  'share link': '링크 공유',
  'link copied ✓': '링크 복사됨 ✓',
  'High price impact: even the best path is thin for this size. Trade smaller.': '가격 영향이 큽니다. 가장 좋은 경로도 이 규모에는 유동성이 얇습니다. 더 작게 거래하세요.',
  'Not enough balance.': '잔액이 부족합니다.',
  'The price moved while this was open: the swap now gives about {now} {token} instead of {was}. Press Swap again to take the new price.': '창을 연 사이 가격이 움직였습니다. 이제 약 {now} {token}을(를) 받습니다 (이전 {was}). 새 가격으로 하려면 스왑을 다시 누르세요.',
  'Try again at {pct}% slippage': '슬리피지 {pct}%로 다시 시도',
  'Checked against the chain before you sign: as it stands this would fail.': '서명 전에 체인에서 확인했습니다. 지금 상태로는 실패합니다.',
  'Use {pct}%': '{pct}% 사용',
  'Checking the price…': '가격 확인 중…',
  'Confirm in wallet…': '지갑에서 확인하세요…',
  'Swapping…': '스왑 중…',
  'Swap anyway': '그래도 스왑',
  '✓ Swapped.': '✓ 스왑 완료.',
  'Receipt →': '영수증 →',
  'Next:': '다음:',
  'See it in your history': '내역에서 보기',
  'Pools with {token}': '{token} 풀',
  'asking your wallet': '지갑에 요청 중',
  'broadcasting': '전송 중',
  'written down': '기록됨',
  'Finding what to pay…': '지불할 수량을 찾는 중…',
  'No amount found that delivers that right now. The pools may be too thin.': '지금은 그만큼을 받을 수 있는 수량을 찾지 못했습니다. 풀의 유동성이 부족할 수 있습니다.',
  'What to pay is worked out from the pools right now, with {pct}% room for the price to move. If the price holds, a little more arrives.': '지불 수량은 지금 풀 기준으로 계산되며 가격 변동 여유 {pct}%를 포함합니다. 가격이 유지되면 조금 더 받습니다.',
  'Size before the price moves': '가격이 움직이기 전 규모',
  '{pct}% at {size}': '{size}에서 {pct}%',
  'about {size}': '약 {size}',
  'under {size}': '{size} 미만',
  'over {size}': '{size} 초과',
  'Select a token': '토큰 선택',
  'Name, ticker, chain, or paste an address': '이름, 티커, 체인 또는 주소 붙여넣기',
  '★ Starred': '★ 즐겨찾기',
  'Recent': '최근',
  'Deepest': '유동성 순',
  'Try “bitcoin”, “gold”, “euro”, “staked luna” or “from noble”.': '“bitcoin”, “gold”, “euro”, “staked luna”, “from noble” 같은 영어 단어로 찾아보세요.',
  'No listed token matches that.': '일치하는 토큰이 없습니다.',
  'That address is not one of the listed tokens here. Unlisted tokens are not offered, so a look-alike cannot slip in.': '이 주소는 여기 등록된 토큰이 아닙니다. 등록되지 않은 토큰은 제공하지 않으므로 비슷한 가짜 토큰이 끼어들 수 없습니다.',
  '{amount} liquidity': '유동성 {amount}',
  'a different token from {others}': '{others}와(과) 다른 토큰',
  'The price moved past your slippage limit before this could land, so nothing was swapped. Try again, or allow a little more slippage.': '스왑이 체결되기 전에 가격이 슬리피지 한도를 넘어 움직여 아무것도 교환되지 않았습니다. 다시 시도하거나 슬리피지를 조금 늘리세요.',
  'Not enough balance for this, counting the network fee in LUNA.': 'LUNA 네트워크 수수료를 포함하면 잔액이 부족합니다.',
  'Transaction cancelled in your wallet.': '지갑에서 거래를 취소했습니다.',
}

const es: Dict = {
  'Swap': 'Intercambiar',
  'Pools': 'Pools',
  'Bridge': 'Puente',
  'Portfolio': 'Cartera',
  'Board': 'Tablero',
  'Search': 'Buscar',
  'Experimental': 'Experimental',
  'TerraLuna apps': 'Apps de TerraLuna',
  'Swap tokens, pools, liquidity, transfers': 'Intercambios, pools, liquidez, transferencias',
  'Collections, items, listings and offers': 'Colecciones, ítems, anuncios y ofertas',
  'Proposals, votes and the community pool': 'Propuestas, votos y el fondo comunitario',
  'here': 'aquí',
  'All apps at terraluna.app': 'Todas las apps en terraluna.app',
  'Language': 'Idioma',
  'Connect': 'Conectar',
  'Connect a wallet': 'Conecta una billetera',
  'Terra, phoenix-1. Nothing is stored; the wallet signs, the chain does the rest.': 'Terra, phoenix-1. No se guarda nada: la billetera firma y la cadena hace el resto.',
  'Browse-only': 'Solo lectura',
  'Best route on Terra · no interface fee': 'La mejor ruta en Terra · sin comisión de interfaz',
  'You pay': 'Pagas',
  'You receive': 'Recibes',
  'Balance': 'Saldo',
  'max': 'máx',
  'or type what you want to receive': 'o escribe lo que quieres recibir',
  'Route': 'Ruta',
  'Split over two paths that share no pool': 'Dividido en dos rutas que no comparten pool',
  'vs one path': 'frente a una sola ruta',
  '+{pct}% more {token}': '+{pct}% más {token}',
  'vs {venue} alone': 'frente a solo {venue}',
  'Rate': 'Tipo de cambio',
  'Price impact': 'Impacto en el precio',
  'Pool fee': 'Comisión del pool',
  'Pool fees': 'Comisiones de los pools',
  'Min. received ({pct}% slippage)': 'Mínimo recibido ({pct}% de deslizamiento)',
  'Min. received ({pct}% slippage, auto)': 'Mínimo recibido ({pct}% de deslizamiento, auto)',
  'Min. received ({pct}% per leg)': 'Mínimo recibido ({pct}% por tramo)',
  'Network fee': 'Comisión de red',
  'You receive at least': 'Recibes al menos',
  'Slippage': 'Deslizamiento',
  'Auto': 'Auto',
  'share link': 'compartir enlace',
  'link copied ✓': 'enlace copiado ✓',
  'High price impact: even the best path is thin for this size. Trade smaller.': 'Impacto alto en el precio: incluso la mejor ruta tiene poca liquidez para este tamaño. Opera con menos.',
  'Not enough balance.': 'Saldo insuficiente.',
  'The price moved while this was open: the swap now gives about {now} {token} instead of {was}. Press Swap again to take the new price.': 'El precio se movió mientras esto estaba abierto: ahora el intercambio da unos {now} {token} en lugar de {was}. Pulsa Intercambiar otra vez para aceptar el nuevo precio.',
  'Try again at {pct}% slippage': 'Reintentar con {pct}% de deslizamiento',
  'Checked against the chain before you sign: as it stands this would fail.': 'Comprobado en la cadena antes de firmar: tal como está, fallaría.',
  'Use {pct}%': 'Usar {pct}%',
  'Checking the price…': 'Comprobando el precio…',
  'Confirm in wallet…': 'Confirma en la billetera…',
  'Swapping…': 'Intercambiando…',
  'Swap anyway': 'Intercambiar de todos modos',
  '✓ Swapped.': '✓ Intercambiado.',
  'Receipt →': 'Recibo →',
  'Next:': 'Siguiente:',
  'See it in your history': 'Verlo en tu historial',
  'Pools with {token}': 'Pools con {token}',
  'asking your wallet': 'pidiendo a tu billetera',
  'broadcasting': 'enviando',
  'written down': 'registrado',
  'Finding what to pay…': 'Calculando cuánto pagar…',
  'No amount found that delivers that right now. The pools may be too thin.': 'Ahora mismo no hay una cantidad que entregue eso. Puede que los pools tengan poca liquidez.',
  'What to pay is worked out from the pools right now, with {pct}% room for the price to move. If the price holds, a little more arrives.': 'Lo que pagas se calcula con los pools en este momento, con un {pct}% de margen para que el precio se mueva. Si el precio se mantiene, llega un poco más.',
  'Size before the price moves': 'Tamaño antes de que se mueva el precio',
  '{pct}% at {size}': '{pct}% con {size}',
  'about {size}': 'unos {size}',
  'under {size}': 'menos de {size}',
  'over {size}': 'más de {size}',
  'Select a token': 'Selecciona un token',
  'Name, ticker, chain, or paste an address': 'Nombre, ticker, cadena o pega una dirección',
  '★ Starred': '★ Favoritos',
  'Recent': 'Recientes',
  'Deepest': 'Con más liquidez',
  'Try “bitcoin”, “gold”, “euro”, “staked luna” or “from noble”.': 'Prueba con “bitcoin”, “gold”, “euro”, “staked luna” o “from noble”.',
  'No listed token matches that.': 'Ningún token listado coincide.',
  'That address is not one of the listed tokens here. Unlisted tokens are not offered, so a look-alike cannot slip in.': 'Esa dirección no es uno de los tokens listados aquí. Los tokens no listados no se ofrecen, así que no se puede colar una imitación.',
  '{amount} liquidity': '{amount} de liquidez',
  'a different token from {others}': 'un token distinto de {others}',
  'The price moved past your slippage limit before this could land, so nothing was swapped. Try again, or allow a little more slippage.': 'El precio superó tu límite de deslizamiento antes de que esto se confirmara, así que no se intercambió nada. Inténtalo de nuevo o permite un poco más de deslizamiento.',
  'Not enough balance for this, counting the network fee in LUNA.': 'Saldo insuficiente para esto, contando la comisión de red en LUNA.',
  'Transaction cancelled in your wallet.': 'Transacción cancelada en tu billetera.',
}

const vi: Dict = {
  'Swap': 'Hoán đổi',
  'Pools': 'Pool',
  'Bridge': 'Cầu nối',
  'Portfolio': 'Danh mục',
  'Board': 'Bảng xếp hạng',
  'Search': 'Tìm kiếm',
  'Experimental': 'Thử nghiệm',
  'TerraLuna apps': 'Ứng dụng TerraLuna',
  'Swap tokens, pools, liquidity, transfers': 'Hoán đổi token, pool, thanh khoản, chuyển tiền',
  'Collections, items, listings and offers': 'Bộ sưu tập, vật phẩm, niêm yết và đề nghị',
  'Proposals, votes and the community pool': 'Đề xuất, bỏ phiếu và quỹ cộng đồng',
  'here': 'tại đây',
  'All apps at terraluna.app': 'Tất cả ứng dụng tại terraluna.app',
  'Language': 'Ngôn ngữ',
  'Connect': 'Kết nối',
  'Connect a wallet': 'Kết nối ví',
  'Terra, phoenix-1. Nothing is stored; the wallet signs, the chain does the rest.': 'Terra, phoenix-1. Không lưu gì cả: ví ký, chuỗi làm phần còn lại.',
  'Browse-only': 'Chỉ xem',
  'Best route on Terra · no interface fee': 'Tuyến tốt nhất trên Terra · không phí giao diện',
  'You pay': 'Bạn trả',
  'You receive': 'Bạn nhận',
  'Balance': 'Số dư',
  'max': 'tối đa',
  'or type what you want to receive': 'hoặc nhập số bạn muốn nhận',
  'Route': 'Tuyến',
  'Split over two paths that share no pool': 'Chia qua hai tuyến không dùng chung pool',
  'vs one path': 'so với một tuyến',
  '+{pct}% more {token}': '+{pct}% {token}',
  'vs {venue} alone': 'so với chỉ {venue}',
  'Rate': 'Tỷ giá',
  'Price impact': 'Tác động giá',
  'Pool fee': 'Phí pool',
  'Pool fees': 'Phí pool',
  'Min. received ({pct}% slippage)': 'Nhận tối thiểu (trượt giá {pct}%)',
  'Min. received ({pct}% slippage, auto)': 'Nhận tối thiểu (trượt giá {pct}%, tự động)',
  'Min. received ({pct}% per leg)': 'Nhận tối thiểu ({pct}% mỗi chặng)',
  'Network fee': 'Phí mạng',
  'You receive at least': 'Bạn nhận ít nhất',
  'Slippage': 'Trượt giá',
  'Auto': 'Tự động',
  'share link': 'chia sẻ liên kết',
  'link copied ✓': 'đã sao chép ✓',
  'High price impact: even the best path is thin for this size. Trade smaller.': 'Tác động giá cao: ngay cả tuyến tốt nhất cũng mỏng với quy mô này. Hãy giao dịch nhỏ hơn.',
  'Not enough balance.': 'Không đủ số dư.',
  'The price moved while this was open: the swap now gives about {now} {token} instead of {was}. Press Swap again to take the new price.': 'Giá đã thay đổi khi trang đang mở: giờ giao dịch cho khoảng {now} {token} thay vì {was}. Nhấn Hoán đổi lần nữa để lấy giá mới.',
  'Try again at {pct}% slippage': 'Thử lại với trượt giá {pct}%',
  'Checked against the chain before you sign: as it stands this would fail.': 'Đã kiểm tra trên chuỗi trước khi bạn ký: như hiện tại giao dịch sẽ thất bại.',
  'Use {pct}%': 'Dùng {pct}%',
  'Checking the price…': 'Đang kiểm tra giá…',
  'Confirm in wallet…': 'Xác nhận trong ví…',
  'Swapping…': 'Đang hoán đổi…',
  'Swap anyway': 'Vẫn hoán đổi',
  '✓ Swapped.': '✓ Đã hoán đổi.',
  'Receipt →': 'Biên nhận →',
  'Next:': 'Tiếp theo:',
  'See it in your history': 'Xem trong lịch sử',
  'Pools with {token}': 'Pool có {token}',
  'asking your wallet': 'đang hỏi ví',
  'broadcasting': 'đang gửi',
  'written down': 'đã ghi nhận',
  'Finding what to pay…': 'Đang tính số cần trả…',
  'No amount found that delivers that right now. The pools may be too thin.': 'Hiện không tìm được số lượng nào nhận đủ như vậy. Pool có thể quá mỏng.',
  'What to pay is worked out from the pools right now, with {pct}% room for the price to move. If the price holds, a little more arrives.': 'Số cần trả được tính từ các pool ngay lúc này, có dư {pct}% cho biến động giá. Nếu giá giữ nguyên, bạn nhận nhiều hơn một chút.',
  'Size before the price moves': 'Quy mô trước khi giá dịch chuyển',
  '{pct}% at {size}': '{pct}% ở {size}',
  'about {size}': 'khoảng {size}',
  'under {size}': 'dưới {size}',
  'over {size}': 'trên {size}',
  'Select a token': 'Chọn token',
  'Name, ticker, chain, or paste an address': 'Tên, mã, chuỗi hoặc dán địa chỉ',
  '★ Starred': '★ Yêu thích',
  'Recent': 'Gần đây',
  'Deepest': 'Sâu nhất',
  'Try “bitcoin”, “gold”, “euro”, “staked luna” or “from noble”.': 'Thử “bitcoin”, “gold”, “euro”, “staked luna” hoặc “from noble”.',
  'No listed token matches that.': 'Không có token nào khớp.',
  'That address is not one of the listed tokens here. Unlisted tokens are not offered, so a look-alike cannot slip in.': 'Địa chỉ đó không phải token được niêm yết ở đây. Token chưa niêm yết không được cung cấp, nên token giả mạo không thể lọt vào.',
  '{amount} liquidity': '{amount} thanh khoản',
  'a different token from {others}': 'token khác với {others}',
  'The price moved past your slippage limit before this could land, so nothing was swapped. Try again, or allow a little more slippage.': 'Giá đã vượt giới hạn trượt giá trước khi giao dịch được ghi nhận, nên không có gì được hoán đổi. Hãy thử lại hoặc cho phép trượt giá cao hơn một chút.',
  'Not enough balance for this, counting the network fee in LUNA.': 'Không đủ số dư cho giao dịch này, tính cả phí mạng bằng LUNA.',
  'Transaction cancelled in your wallet.': 'Giao dịch đã bị hủy trong ví.',
}

const DICTS: Record<Exclude<Lang, 'en'>, Dict> = { ko, es, vi }
const KEY = 'terraswap_lang'
const EVENT = 'terra:lang'

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && LANGS.some(l => l.code === v)

/** A sentence in `lang`, with `{name}` filled from `vars`. English, or a missing translation, reads as the key itself. */
export function translate(lang: Lang, s: string, vars?: Record<string, string | number>): string {
  const base = lang === 'en' ? s : DICTS[lang][s] ?? s
  return vars ? base.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : base
}

/** ?lang= first, then a choice made on this device, then the first of the browser's languages this site speaks. */
export function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (isLang(q)) return q
    const kept = localStorage.getItem(KEY)
    if (isLang(kept)) return kept
  } catch { /* private mode */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = (l || '').slice(0, 2).toLowerCase()
    if (isLang(code)) return code
  }
  return 'en'
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang) } catch { /* private mode: this visit only */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: lang })) } catch { /* ssr */ }
}

/** The language in use and a translator for it. English until mounted, so the server and the first paint agree. */
export function useLang(): { lang: Lang; t: (s: string, vars?: Record<string, string | number>) => string } {
  const [lang, set] = useState<Lang>('en')
  useEffect(() => {
    const apply = (l: Lang) => { set(l); try { document.documentElement.lang = l } catch { /* ssr */ } }
    apply(detectLang())
    const on = (e: Event) => { const l = (e as CustomEvent<Lang>).detail; if (isLang(l)) apply(l) }
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  return { lang, t: (s, vars) => translate(lang, s, vars) }
}
