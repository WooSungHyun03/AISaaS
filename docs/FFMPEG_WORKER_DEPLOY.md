# 광고 영상 서비스 연결: FFmpeg 워커 배포

"영상 제작 서비스가 아직 연결되지 않아…" 는 영상 생성에 필요한 설정이 빠졌다는 뜻이에요. 운영(Vercel)에는 `AD_VIDEO_PROVIDER`, `FAL_KEY`, `AI_PROVIDER`, `ANTHROPIC_API_KEY`,
`POSTPROCESS_PROVIDER`, `POSTPROCESS_WORKER_TOKEN`, `ALLOW_PAID_AI_CALLS`, `BUDGET_PERIOD_*` 가 있고, **`POSTPROCESS_WORKER_URL`(FFmpeg 워커 주소)만 없었어요**(2026-10-21 확인).
워커는 로고·문구 합성, 길이 측정, 인코딩을 하는 작은 서버(`worker/ffmpeg`)라서 어딘가에 한 번 배포해야 해요. 관리자 `/admin/scheduler` 의 "광고 영상 서비스 연결"에서 무엇이 빠졌는지 이름으로 볼 수 있어요.

## 1. 워커 배포 (둘 중 편한 곳)

공통 환경변수 (`worker/ffmpeg/README.md` 참고):
- `WORKER_TOKEN` = Vercel 의 `POSTPROCESS_WORKER_TOKEN` 과 **같은 값**(16자 이상). 값을 모르면 새로 만들어(`openssl rand -hex 24`) 양쪽에 같이 넣어요.
- `WORKER_ALLOWED_HOSTS` = `dvkfvommrhvlvuccxgeh.supabase.co,.fal.media,.fal.run`
- 컨테이너 2 vCPU 이상, 항상 켜져 있어야 해요(작업이 요청보다 오래 걸려요).

**Fly.io**: `cd worker/ffmpeg && fly launch --no-deploy --copy-config --dockerfile Dockerfile` → `fly secrets set WORKER_TOKEN=… WORKER_ALLOWED_HOSTS=…` → `fly deploy` (설정은 `worker/ffmpeg/fly.toml`).
**Railway**: New Project → Deploy from GitHub repo → Root Directory `worker/ffmpeg`(Dockerfile 자동 인식) → Variables 에 위 두 값 → Settings → Networking → Generate Domain.

배포 뒤 확인: `curl https://<워커 주소>/healthz` 가 `ok` 를 돌려줘야 해요.

## 2. Vercel 에 주소 넣기

Production 환경변수 `POSTPROCESS_WORKER_URL` = `https://<워커 주소>` (끝에 `/` 없이) → 다시 배포.

## 3. 확인

- 관리자 `/admin/scheduler` → "광고 영상 서비스 연결"이 "모두 연결됨".
- (선택) 로컬에서 `node --env-file=.env.local scripts/check-providers.mjs`.
- 영상 한 편을 만들어 보고 fal 청구서와 `output.generation.costUsd` 를 비교해요(`docs/AD_SHORTS.md` "First real video").
