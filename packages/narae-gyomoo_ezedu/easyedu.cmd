@echo off
python -X utf8 "%~dp0scripts\easyedu_schedule.py" %*
exit /b %errorlevel%
