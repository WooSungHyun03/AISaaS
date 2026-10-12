/**
 * Deterministic answers of the mock AI for the ad-video pipeline (local development and CI): image analysis, the ad
 * plan and the frame QA. They satisfy the same schemas and rules as real answers.
 */
function number(prompt: string, key: string, fallback: number): number {
  const match = prompt.match(new RegExp(`^${key}=(\\d+)`, "m"));
  return match ? Number(match[1]) : fallback;
}

export function mockImageAnalysis(prompt: string): string {
  const labels = [...prompt.matchAll(/^Image (\d+) label: "([^"]*)"/gm)].map((match) => ({ index: Number(match[1]), label: match[2] }));
  return JSON.stringify({
    images: labels.map(({ index, label }) => ({
      index,
      role: /캐릭터|마스코트|로봇|character|mascot/i.test(label) ? "character" : /사람|사장|직원|손님|모델|person/i.test(label) ? "person" : /매장|가게|내부|외관|공간|place|shop/i.test(label) ? "place" : "product",
      summary: label || "상품이 보이는 사진",
      visibleText: [],
    })),
  });
}

export function mockAdPlan(prompt: string, system = ""): string {
  const duration = number(prompt, "DURATION", 25);
  const images = number(prompt, "IMAGE_COUNT", 0);
  const videos = number(prompt, "VIDEO_COUNT", 0);
  const audios = number(prompt, "AUDIO_COUNT", 0);
  const exact = prompt.match(/^Images ([\d, ]+) are 'exact' images/m)?.[1].split(",").map((item) => Number(item.trim())).filter(Boolean) ?? [];
  const hasLogo = /The owner's logo exists/.test(prompt);
  const fixedTopic = prompt.match(/Use exactly this planned topic without replacing it: "([^"]+)"/)?.[1];
  const business = system.match(/(?:상호|상품명|서비스명):\s*(.+)/)?.[1]?.trim() ?? "우리 가게";
  const topic = fixedTopic ?? `${business}의 대표 메뉴 소개`;
  const round = (value: number) => Math.round(value * 10) / 10;
  const marks = [0, 2, round(duration * 0.35), round(duration * 0.6), round(duration * 0.85), duration];
  const lines = ["오늘 소개할 건 바로 이거예요.", "정성껏 준비한 대표 메뉴예요.", "한 번 맛보면 이유를 아실 거예요.", "편안한 분위기에서 즐겨 보세요.", "지금 바로 만나 보세요."];
  const visuals = [
    "Close-up of the real product in warm natural light, steam rising, the hook shot that stops the scroll.",
    "Slow push-in on the product on a wooden table, soft background blur.",
    "A hand lifts the product toward the camera, gentle handheld motion.",
    "Wide shot of the warm, welcoming space with soft daylight.",
    "The product centered again, calm and clean framing for the closing.",
  ];
  return JSON.stringify({
    topic,
    concept: "실제 상품을 가까이에서 보여주며 믿음을 주는 따뜻한 소개 영상",
    message: "정성껏 준비한 대표 메뉴를 지금 만나 보세요",
    audience: "근처에서 괜찮은 곳을 찾는 20-40대",
    hook: { text: "오늘 소개할 건 바로 이거예요", visual: visuals[0] },
    storyboard: lines.map((narration, index) => ({ startSec: marks[index], endSec: marks[index + 1], visual: visuals[index], camera: index % 2 === 0 ? "slow push-in" : "gentle pan right", narration })),
    references: [
      ...Array.from({ length: images }, (_, index) => ({ type: "image", index: index + 1, role: exact.includes(index + 1) ? "an exact label image, shown by the app, do not redraw" : "the real product, keep its shape, colour and label exactly" })),
      ...Array.from({ length: videos }, (_, index) => ({ type: "video", index: index + 1, role: "motion and atmosphere reference" })),
      ...Array.from({ length: audios }, (_, index) => ({ type: "audio", index: index + 1, role: "background music mood reference" })),
    ],
    look: { camera: "stable smartphone-style vertical framing", lighting: "warm soft daylight", color: "warm natural tones" },
    audio: { music: "warm acoustic instrumental with a light beat", sfx: ["soft ambient room tone"] },
    narration: lines.join(" "),
    cta: { text: "지금 바로 방문해 보세요", startSec: round(duration - 4) },
    logo: { show: hasLogo, position: "top-right" },
    inserts: exact.slice(0, 1).map((imageIndex) => ({ imageIndex, startSec: round(duration - 6), endSec: round(duration - 3) })),
    preservation: ["the product shape, colour and label stay exactly as in the reference images"],
  });
}

export function mockAdQa(): string {
  const ok = { ok: true, note: "" };
  return JSON.stringify({
    checks: { hook: ok, concept: ok, productFidelity: ok, brandText: ok, uiFabrication: ok, subtitles: ok, artifacts: ok, continuity: ok },
    problems: [],
    summary: "화면에서 눈에 띄는 문제는 보이지 않아요. 직접 한 번 더 확인해 주세요.",
  });
}
