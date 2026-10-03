import { describe, expect, it } from "vitest";
import { shortsContentSchema } from "./shorts";

const validContent = {
  hook: "아침마다 빵을 기다리고 계신가요?",
  script: "바쁜 출근길에는 기다릴 시간이 부족합니다. 빵을 미리 예약하면 갓 구운 메뉴를 바로 받을 수 있어요. 오늘 아침 메뉴를 예약해보세요.",
  scenes: [
    { text: "아침마다 기다리세요?", visualPrompt: "출근 시계를 보는 고객, 세로 9:16 클로즈업", durationSec: 3 },
    { text: "바쁜 아침엔 시간이 부족하죠", visualPrompt: "빵집 앞에서 시계를 보는 직장인, 세로 9:16", durationSec: 4 },
    { text: "미리 예약하면 바로 픽업", visualPrompt: "포장된 빵을 건네는 장면, 세로 9:16", durationSec: 5 },
    { text: "오늘 메뉴를 예약하세요", visualPrompt: "빵 봉투를 들고 웃는 고객, 세로 9:16", durationSec: 5 },
  ],
  caption: "출근길 빵을 빠르게 픽업하세요. #아침빵 #빵예약 #동네빵집",
  privacy: "private",
};

describe("shortsContentSchema", () => {
  it("accepts a 15-45 second scene plan with a platform caption", () => {
    expect(shortsContentSchema.parse(validContent)).toEqual(validContent);
  });

  it("rejects a first hook scene longer than 3 seconds", () => {
    const result = shortsContentSchema.safeParse({
      ...validContent,
      scenes: [{ ...validContent.scenes[0], durationSec: 4 }, ...validContent.scenes.slice(1)],
    });

    expect(result.success).toBe(false);
  });

  it("rejects plans outside the 15-45 second range or without enough hashtags", () => {
    const result = shortsContentSchema.safeParse({
      ...validContent,
      scenes: validContent.scenes.map((scene) => ({ ...scene, durationSec: 2 })),
      caption: "출근길 빵을 빠르게 픽업하세요. #아침빵",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(expect.arrayContaining(["scenes", "caption"]));
    }
  });
});
