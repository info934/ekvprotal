@echo off
ssh -t root@192.168.1.193 "tmux new-session -A -s ekvportal -c /root/ekvportal"
pause
