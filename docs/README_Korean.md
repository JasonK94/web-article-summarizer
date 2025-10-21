# 웹 기사 요약 도구

이 프로젝트는 웹 기사를 스크랩하고, LLM(대규모 언어 모델)을 사용하여 요약하며, 다양한 모델과 프로필에 따른 결과물의 품질과 비용을 분석하는 자동화된 도구입니다.

- **`CONTEXT.md` 파일 필독**: 이 프로젝트의 운영 가이드라인이 담겨 있습니다. 요청 속도에 주의하고, 수집과 요약 단계를 분리하며, 가능한 아카이브를 우선 사용하고, 사이트의 서비스 약관을 존중해야 합니다.

## 권장 워크플로우

이 프로젝트는 여러 스크립트로 구성되어 있습니다. 표준적인 사용을 위해 아래 번호 순서를 따라주세요.

### 1단계: 수집 (Harvest)

이 단계는 실제 웹사이트에 접속하여 기사 원문(HTML)을 다운로드합니다. 유일하게 라이브 웹 요청을 보내는 단계이며, 봇 탐지를 피하기 위해 신중하고 느리게 작동하도록 설계되었습니다.

**➡️ Chrome 브라우저를 닫은 상태에서 이 명령어를 실행하세요:**
```bash
node harvest.js
```
- **입력**: `urls.csv` 또는 `urls.txt`.
- **출력**: `archive/pages/*.html` (기사 본문) 및 `archive/archive_index.csv` (메타데이터 색인).
- **동작 방식**: 실제 사용자 프로필(`--user-data-dir`)을 사용하여 **GUI가 보이는 non-headless** Chrome 브라우저를 실행, 기존 로그인 세션을 활용합니다. `puppeteer-extra-plugin-stealth` 플러그인으로 자동화 도구의 흔적을 숨깁니다. 사람처럼 보이기 위해 표준 `1920x1080` 뷰포트를 설정하고, 각 동작 사이에 무작위로 대기하며, 마우스를 움직이고 여러 번 스크롤합니다. 자동화의 명백한 증거인 `page.pdf()` 대신 전체 HTML 소스를 저장합니다.

### 2단계: 요약 (Summarize)

이 단계는 로컬에 저장된 파일을 처리하여 요약을 생성합니다. 1단계에서 아카이브가 생성되었다면 웹사이트에 다시 접속하지 않습니다.

#### 옵션 2a: 수집된 아카이브에서 요약
**➡️ 이 명령어를 실행하세요:**
```bash
node app.js --provider openai --model gpt-4o-mini --profile investor
```
- **입력**: `archive/archive_index.csv` 및 `archive/pages/*.html`. 만약 URL에 해당하는 아카이브 파일이 없으면, 최후의 수단으로 **라이브 요청**을 시도합니다.
- **출력**: 새로운 요약 결과를 `output/all_runs.csv`에 추가합니다. 마지막 실행에 대한 `output/last_run.json` 보고서와 개별 `output/[기사명]_[모델]_[프로필].md` 파일도 생성합니다.
- **동작 방식**: URL 목록을 읽고, `all_runs.csv`에 이미 요약이 있는지 확인 후 (`--duplicate false` 설정 시 건너뜀), 기사 본문을 불러옵니다(로컬 아카이브 우선). 그 다음 지정된 LLM 제공자(OpenAI/Gemini)를 호출하여 영문 요약을 생성하고, 이어서 비용 효율적인 Gemini 모델로 한국어 번역을 생성합니다. 모든 결과는 중앙 CSV 파일에 저장됩니다.

#### 옵션 2b: 수동 소스에서 요약
기사 본문을 직접 복사해서 사용하고 싶을 때 이 옵션을 사용합니다.

**➡️ `sources.csv`를 준비한 후 이 명령어를 실행하세요:**
```bash
node sources-run.js
```
- **입력**: `sources.csv` (스키마: `id,title,url,type,content`).
- **출력**: 새로운 요약 결과를 `output/all_runs.csv`에 추가합니다. 개별 `output/[기사명]_[id]_[모델]_[프로필].manual.md` 파일도 생성합니다.
- **동작 방식**: `sources.csv` 파일을 파싱합니다. `type=html`이면 `cheerio`를 사용해 본문을 추출합니다. 그 다음 지정된 LLM 제공자를 호출하여 영문 및 한글 요약을 생성하고, 모든 결과를 중앙 `all_runs.csv`에 추가하여 평가 단계에서 사용할 수 있도록 합니다.

### 3단계: 분석 및 평가 (Analyze and Assess)

이 단계에서는 `output/all_runs.csv`에 축적된 요약 데이터를 사용하여 심층 분석을 수행합니다.

#### 평가자 & 분석 도구

이 프로젝트에는 `evaluate-models.js`와 `assessor-run.js` 두 가지 분석 스크립트가 있습니다.

**`evaluate-models.js` (모델 중심 성능 테스트)**
- **목적**: 여러 모델에 대해 샘플 URL을 테스트하여 API 호환성, 오류 발생 여부, 기본 성능 지표(토큰 수, 비용 등)를 빠르게 확인하는 용도입니다. 심층적인 품질 분석은 수행하지 않습니다.
- **동작 방식**: 샘플 콘텐츠가 담긴 플레이스홀더 프롬프트를 사용하여 LLM API(OpenAI/Gemini)에 **라이브 호출**을 보냅니다. API 자격 증명과 모델 가용성을 확인하는 것이 주 목적이므로, `urls.csv`나 아카이브의 실제 기사 내용은 사용하지 않습니다.
- **출력**: `evaluation/model_evaluation_report.md` 및 `evaluation_results.csv` 파일에 토큰 수, 비용과 같은 개괄적인 통계를 생성합니다.
- **CLI 옵션**:
  - `--models <모델1> <모델2> ...`: 테스트할 모델을 지정합니다 (`config/profiles.json` 참조).

**`assessor-run.js` (품질 중심 평가)**
- **목적**: 이미 생성하여 `output/all_runs.csv`에 저장해 둔 요약들에 대해 심도 있는 정성적(qualitative) 평가를 수행합니다.
- **동작 방식**: `output/all_runs.csv`의 모든 요약을 읽습니다. 각 요약에 대해, 별도의 LLM("평가자")에게 미리 정의된 기준(예: 정확성, 명료성)에 따라 점수를 매기고 피드백을 생성하도록 요청합니다. **요약 1개당, 평가자 1명씩 API를 호출**하여 안정적으로 결과를 얻습니다. 모든 평가가 끝나면 결과를 파일에 한 번에 저장하여 오류를 방지합니다.
- **출력**: `evaluation/assessment_results.csv` 파일을 "Wide Format"으로 생성합니다. 각 행은 하나의 요약을 나타내며, 컬럼에는 각 평가자의 점수와 서면 피드백, 그리고 종합 평균 점수가 포함되어 비교가 용이합니다.
- **CLI 옵션**:
  - `--provider <openai|gemini>`: 평가자 모델로 사용할 제공자를 지정합니다.
  - `--assessorModel <모델명>`: 평가를 수행할 특정 모델을 지정합니다 (예: `gpt-4o`). 지정하지 않으면 `.env`의 기본 모델을 사용합니다.
  - `--assessors <프로필1> <프로필2> ...`: 사용할 평가자 프로필을 지정합니다 (`config/profiles.json` 참조).

### 4단계: 요약 향상 (Enhance)

이것은 선택적이지만 강력한 단계로, LLM을 편집자로 활용하여 요약의 품질을 반복적으로 개선합니다.

**➡️ 이 명령어를 실행하세요:**
```bash
node summary-enhancer.js --enhancer professional --model gpt-4o
```
- **입력**: `output/all_runs.csv`.
- **출력**: `output/all_runs.csv` 파일을 직접 수정하여, 수정된 요약이 담긴 새 열(예: `enhanced_professional_summary`)을 추가합니다.
- **동작 방식**: `all_runs.csv`의 각 요약을 읽어, 특정 "향상" 프롬프트(`config/profiles.json`에 정의됨)와 함께 LLM에 보낸 후 결과를 저장합니다. 예를 들어, 이 기능을 사용해 모든 요약을 특정 전문적인 톤으로 통일하거나, 더 넓은 독자층을 위해 단순화할 수 있습니다.
- **CLI 옵션**:
  - `--enhancer <프로필>`: **필수**. 사용할 향상 프로필 (예: `professional`, `simple`).
  - `--provider <openai|gemini>`: 향상 모델로 사용할 제공자를 지정합니다.
  - `--model <모델명>`: 향상 작업에 사용할 특정 모델을 지정합니다 (예: `gpt-4o`).

### 5단계: 유지보수

**➡️ 필요할 때 이 명령어를 실행하세요:**
```bash
node update-models.js
```