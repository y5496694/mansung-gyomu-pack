// Keep the offline in-app guide and public user documentation on the same source.
const fs=require('node:fs'),path=require('node:path'),guide=require('../ui/narae3-guide-data.js');
const lines=['# 나래3 사용 안내','',`기준: ${guide.updated} · 오피스 ${guide.version}`,'','앱의 **설정 → 사용 안내** 또는 **나래 에이전트 → 나래3 사용 안내**에서 검색·영역 선택·예시 복사로 볼 수 있습니다. 인터넷·AI 실행 없이 열립니다. 예시 복사는 실제 작업을 실행하지 않습니다.','','![앱 안에서 보는 나래3 사용 안내](images/narae3-guide.png)','',guide.intro,'',guide.modelNote,'','## 검증 수준',''];
for(const value of Object.values(guide.levels))lines.push(`- **${value.label}:** ${value.description}`);
for(const topic of guide.topics){lines.push('',`## ${topic.title}`,'',`영역: ${topic.category} · ${guide.levels[topic.level].label}`,'',topic.summary);for(const [title,key]of [['요청할 수 있는 일','tasks'],['요청 예시','examples'],['사용 전 준비','requirements'],['제한과 확인할 점','limits']]){lines.push('',`### ${title}`,'');for(const value of topic[key])lines.push('- '+value);}lines.push('','### 확인한 범위','',topic.evidence);}
lines.push('','## 관련 안내','','- [실제 가중치 학습·실행 검증 기록](narae3-office-training-20261030.md)','- [나이스 에이전트](나이스-에이전트.md)','- [명시적으로 요청한 상신·결재](상신-결재.md)','- [텔레그램과 나래AI](텔레그램과-나래AI.md)','- [카카오톡 PC 연결](카카오톡-PC연결.md)','- [사진·PDF 이해 확장 방향](사진-PDF-이해.md)','');
const output=lines.join('\n'),target=path.resolve(__dirname,'../docs/나래3-사용안내.md');
if(process.argv.includes('--check')){if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output)throw Error('사용 안내가 변경됐습니다. node scripts/write-user-guide.cjs를 실행하세요.');}else fs.writeFileSync(target,output);
