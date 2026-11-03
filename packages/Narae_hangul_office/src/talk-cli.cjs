#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.NARAE_PRODUCT='talk';
process.env.NARAE_OFFICE_HOME=process.env.NARAE_TALK_HOME||path.join(fs.existsSync('D:/Codex')?'D:/Codex/narae-data':process.env.LOCALAPPDATA||os.homedir(),'NaraeTalk');
const args=process.argv.slice(2);
if(!args.length||['help','--help','-h'].includes(args[0]))console.log('나래톡 CLI\nnarae-talk agent-status | agent 작업.json [--result 결과.json]\nnarae-talk school-status | school-config 설정.json | cron list | cron save 예약.json | cron remove ID | bench status\n작업 JSON: {"prompt":"요청","workspace":"D:/Codex/workspaces/문서","friend":"narae","model":"narae4","allowChanges":false}\n문서 전용 CLI는 narae-office입니다. 데스크톱 앱은 나래톡 실행.cmd로 엽니다.');
else if(!['agent','agent-status','cron','school-status','school-config','bench','schema'].includes(args[0])){console.error('나래톡에서 지원하지 않는 명령입니다. narae-talk help로 확인하세요.');process.exitCode=1;}
else require('./cli.cjs').main(args).then(code=>process.exitCode=code).catch(error=>{console.error(error.message);process.exitCode=1;});
