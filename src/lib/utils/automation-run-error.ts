/** Client-safe explanation for errors stored by the automation runner. */
export function describeAutomationRunError(message: string | null | undefined): string {
  if (!message) return "실행에 실패했습니다. 자동화 설정을 확인한 뒤 다시 시도해주세요.";

  const error = message.toLowerCase();
  if (error.includes("already has a run") || error.includes("one_active_run")) {
    return "이미 실행 중입니다. 완료된 뒤 다시 시도해주세요.";
  }
  if (error.includes("wordpress")) {
    if (/http 40[13]|authentication|application password|credential|권한|연결 정보/.test(error)) {
      return "WordPress 인증 또는 글 작성 권한을 확인해주세요. 설정에서 연결 정보를 다시 입력할 수 있습니다.";
    }
    if (/http 404|rest api/.test(error)) {
      return "WordPress 주소 또는 REST API 경로를 확인해주세요.";
    }
    if (/시간이 초과|timeout|timed out/.test(error)) {
      return "WordPress 응답이 늦어 실행이 중단되었습니다. 사이트 상태를 확인한 뒤 다시 시도해주세요.";
    }
    return "WordPress에 글을 저장하지 못했습니다. 사이트 연결과 발행 설정을 확인해주세요.";
  }
  if (/api_key|api key|missing_api_key|authentication rejected/.test(error)) {
    return "AI 서비스 연결 정보가 올바르지 않습니다. 관리자에게 API 설정 확인을 요청해주세요.";
  }
  if (/rate.limit|429|too many requests/.test(error)) {
    return "AI 서비스 요청이 일시적으로 많습니다. 잠시 후 다시 실행해주세요.";
  }
  if (/timed out|timeout|시간이 초과/.test(error)) {
    return "AI 서비스 응답이 늦어 실행이 중단되었습니다. 잠시 후 다시 시도해주세요.";
  }
  if (/invalid_structured_response|invalid json|parse|schema validation/.test(error)) {
    return "AI가 생성한 글을 처리하지 못했습니다. 다시 실행해주세요.";
  }
  if (/network|fetch failed|provider unavailable|upstream error/.test(error)) {
    return "외부 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
  return "실행 중 문제가 발생했습니다. 설정을 확인한 뒤 다시 시도해주세요.";
}
