# 영상 (ffmpeg)

두 가지 일이 있다. **새로 만들기**(장면 그림에 시간과 자막을 넣어 이어 붙인다)와 **받은 영상 편집**(재료로 받은 영상을 자르고 · 붙이고 · 크기를 바꾸고 · 자막 · 소리를 고친다, 아래 "받은 영상 편집").
음성을 만들거나(내레이션) 음성을 글자로 바꾸는 도구는 없다.

## 장면 그리기

슬라이드로 장면을 만들고 PNG로 그린다 (references/slides.md). 1920×1080에 맞춘다.

```bash
mkdir -p frames
soffice --headless --convert-to pdf --outdir frames 장면.pptx >/dev/null
pdftoppm -png -scale-to-x 1920 -scale-to-y 1080 frames/장면.pdf frames/s   # frames/s-01.png …
```

## 이어 붙이기

장면 목록 파일 (`scenes.txt`). 마지막 장면은 한 번 더 적어야 길이가 지켜진다:

```
file 'frames/s-01.png'
duration 5
file 'frames/s-02.png'
duration 7
file 'frames/s-02.png'
```

```bash
ffmpeg -y -f concat -safe 0 -i scenes.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 23 -movflags +faststart 영상.mp4
```

## 자막

SRT 파일을 쓰고 영상에 굽는다:

```
1
00:00:00,000 --> 00:00:05,000
첫 장면의 자막

2
00:00:05,000 --> 00:00:12,000
둘째 장면의 자막
```

```bash
ffmpeg -y -i 영상.mp4 \
  -vf "subtitles=자막.srt:force_style='FontName=Noto Sans CJK KR,FontSize=22,Outline=1'" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart 영상-자막.mp4
```

자막은 한 줄 20자 안쪽, 한 번에 두 줄까지. 장면 길이는 자막을 읽을 수 있게 (한 줄에 2초 이상).

## 움직이는 도표

matplotlib로 틀마다 PNG를 그려 이어 붙인다 (`fig.savefig(f"frames/c-{i:04d}.png", dpi=100)`):

```bash
ffmpeg -y -framerate 30 -i frames/c-%04d.png -c:v libx264 -pix_fmt yuv420p 도표.mp4
```

## 받은 영상 편집

재료 폴더의 영상을 고친다. 원본은 덮어쓰지 않고 새 파일로 낸다.
영상을 직접 볼 수는 없다: **뽑은 그림**과 **소리가 있는 구간**으로 판단한다. 지시에 시각("1분 20초부터 2분까지")이 있으면 그대로 따르고, 없으면("지루한 부분 빼 줘") 아래 "먼저 읽기"로 근거를 만든 뒤 무엇을 남기고 뺐는지 답에 적는다.

### 먼저 읽기

```bash
# 길이 · 크기 · 해상도 · 소리가 있는지
ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate -of default=nw=1 원본.mp4
# 장면표: 10초마다 한 장씩 뽑아 한 그림으로 (Read로 본다). 긴 영상은 fps=1/30, 칸 수(tile)를 늘린다
ffmpeg -y -v error -i 원본.mp4 -vf "fps=1/10,scale=320:-1,tile=5x4" -frames:v 1 장면표.png
# 소리가 없는 구간 (말이 끊긴 곳). 기준은 영상마다 다르다: 잡음이 많으면 -30dB, 조용하면 -40dB
ffmpeg -i 원본.mp4 -af silencedetect=noise=-35dB:d=0.7 -f null - 2>&1 | grep -o "silence_\(start\|end\): [0-9.]*"
# 화면이 크게 바뀌는 곳 (컷)
ffmpeg -i 원본.mp4 -vf "select='gt(scene,0.3)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```

### 자르기 · 이어 붙이기

```bash
# 한 구간만 (2초~5.5초). -ss · -to를 -i 앞에 두고 다시 인코딩해야 정확히 잘린다 (-c copy는 몇 초 어긋난다)
ffmpeg -y -ss 2 -to 5.5 -i 원본.mp4 -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -movflags +faststart 구간.mp4

# 여러 구간을 골라 한 편으로 (1~4초, 11~15초). 구간마다 trim · atrim 한 쌍, 끝에 concat=n=<구간 수>
ffmpeg -y -i 원본.mp4 -filter_complex \
  "[0:v]trim=1:4,setpts=PTS-STARTPTS[v0];[0:a]atrim=1:4,asetpts=PTS-STARTPTS[a0];\
   [0:v]trim=11:15,setpts=PTS-STARTPTS[v1];[0:a]atrim=11:15,asetpts=PTS-STARTPTS[a1];\
   [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -movflags +faststart 편집.mp4
```

- 소리가 없는 영상은 `[0:a]…` 줄과 `:a=1` · `-map "[a]"` · `-c:a aac`를 뺀다 (`concat=n=2:v=1:a=0[v]`).
- 서로 다른 영상을 붙일 때는 먼저 해상도 · 프레임을 맞춘다 (`scale=1920:1080,fps=30`).

### 무음 구간 빼기

구간이 많으면 손으로 적지 않고 스크립트로 만든다 (`keep.py`로 저장해 `python3 keep.py 원본.mp4 결과.mp4`):

```python
import re, subprocess, sys
src, out = sys.argv[1], sys.argv[2]
NOISE, MIN_SILENCE, PAD = "-35dB", 0.7, 0.15   # 무음 기준 · 이보다 긴 무음만 · 말 앞뒤에 남길 여유(초)
log = subprocess.run(["ffmpeg", "-i", src, "-af", f"silencedetect=noise={NOISE}:d={MIN_SILENCE}", "-f", "null", "-"],
                     capture_output=True, text=True).stderr
starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", log)]
ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", log)]
total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", src],
                             capture_output=True, text=True).stdout)
keep, at = [], 0.0
for i, start in enumerate(starts):
    if start - at > 0.2:
        keep.append((max(0.0, at - PAD), start + PAD))
    at = ends[i] if i < len(ends) else total
if total - at > 0.2:
    keep.append((max(0.0, at - PAD), total))
if not keep:
    sys.exit("남길 구간이 없어요 (기준을 낮춰 보세요)")
parts = "".join(
    f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}];[0:a]atrim={a:.3f}:{b:.3f},asetpts=PTS-STARTPTS[a{i}];"
    for i, (a, b) in enumerate(keep))
joined = "".join(f"[v{i}][a{i}]" for i in range(len(keep)))
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-filter_complex",
                f"{parts}{joined}concat=n={len(keep)}:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out], check=True)
print("남긴 구간:", ", ".join(f"{a:.1f}~{b:.1f}초" for a, b in keep))
```

찍힌 "남긴 구간"을 답에 옮긴다. 줄어든 길이가 지나치면(절반 넘게 사라짐) 기준을 낮춰 다시 돌린다.

### 크기 · 속도

```bash
# 세로(9:16)로: 가운데를 잘라 낸다 (사람이 가운데 있을 때)
ffmpeg -y -i 원본.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a copy 세로.mp4
# 세로(9:16)로: 잘리지 않게 넣고 위아래는 흐린 배경
ffmpeg -y -i 원본.mp4 -filter_complex \
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20[bg];[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a copy 세로.mp4
# 1.5배 빠르게 (atempo는 0.5~2.0. 더 빠르게는 atempo=2.0,atempo=1.5처럼 잇는다)
ffmpeg -y -i 원본.mp4 -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac 빠르게.mp4
```

가운데를 자르기 전에 장면표로 사람 · 글자가 잘리지 않는지 본다. 잘리면 흐린 배경 쪽을 쓴다.

### 소리

```bash
# 음량 맞추기 (작거나 들쭉날쭉한 말소리)
ffmpeg -y -i 원본.mp4 -af loudnorm=I=-16:TP=-1.5:LRA=11 -c:v copy -c:a aac 음량.mp4
# 배경 음악 섞기: 음악은 재료로 받은 파일만 쓴다. 말소리보다 작게(0.15), 영상 길이에 맞춰 되풀이
ffmpeg -y -i 원본.mp4 -stream_loop -1 -i 음악.mp3 -filter_complex \
  "[1:a]volume=0.15[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -shortest 음악.mp4
# 소리 빼기
ffmpeg -y -i 원본.mp4 -an -c:v copy 무음.mp4
```

### 글자 · 로고 · 자막

```bash
# 글자 얹기 (0.5~2.5초 동안 아래 가운데)
ffmpeg -y -i 원본.mp4 -vf "drawtext=text='첫 장면':font='Noto Sans CJK KR':fontsize=56:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-140:enable='between(t,0.5,2.5)'" \
  -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a copy 글자.mp4
# 로고 얹기 (오른쪽 위, 재료로 받은 그림)
ffmpeg -y -i 원본.mp4 -i 로고.png -filter_complex "[0:v][1:v]overlay=W-w-40:40" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a copy 로고.mp4
```

- 자막은 위 "자막"처럼 SRT를 써서 굽는다. **말을 받아 적지 못한다**: 지시나 재료에 대본 · 자막 글이 있을 때만 넣고, 없으면 넣지 않고 답에 "자막은 대본이 있어야 넣을 수 있어요"라고 적는다. 들리는 대로 지어내지 않는다.
- 대본만 있고 시각이 없으면 무음 구간(말이 끊긴 곳)을 경계로 문장을 나눠 맞추고, 맞춘 곳 몇 군데를 그림으로 뽑아 본다. 어긋날 수 있다고 답에 적는다.
- 작은따옴표 · 쉼표 · 콜론이 든 글자는 `drawtext`에서 깨진다: 글을 파일에 쓰고 `textfile=글.txt`로 준다.

### 편집한 영상 확인

- 길이가 계획과 맞는지, 소리 줄이 남아 있는지 `ffprobe`로 본다.
- 이어 붙인 곳 앞뒤를 그림으로 본다: `ffmpeg -y -v error -ss <이은 곳 - 0.1> -i 편집.mp4 -vf "fps=10,scale=320:-1,tile=3x1" -frames:v 1 이음.png`
- 편집한 영상의 장면표를 다시 뽑아 원본의 것과 견준다 (빼라고 한 곳이 빠졌는지, 남길 곳이 남았는지).
- 오래 걸린다: 1080p 10분을 다시 인코딩하면 10분 넘게 걸릴 수 있다. 여러 편집은 한 번의 `-filter_complex`로 묶어 인코딩 횟수를 줄이고, 먼저 앞 30초(`-t 30`)로 시험한다.

## 확인과 내기

- 길이 · 크기: `ffprobe -v error -show_entries format=duration,size -of default=nw=1 영상.mp4`
- 몇 장면을 그림으로 뽑아 Read로 본다: `ffmpeg -y -ss 3 -i 영상.mp4 -frames:v 1 check.png`
- 결과물은 100MB까지다. 넘으면 `-crf`를 올리거나(26~28) 해상도를 1280×720으로 낮춘다.
- 결과물 폴더에는 최종 mp4만 둔다 (자막을 구웠으면 자막판만). 받은 원본 · 중간 파일 · 장면표는 두지 않는다.
