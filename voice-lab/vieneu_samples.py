import sys, time
from vieneu import Vieneu

out = sys.argv[1]
text = "Xin chào Master. Hệ thống Fairy đã sẵn sàng, mọi chỉ số đều ổn định."
names = ["Trúc Ly", "Mai Anh", "Ngọc Huyền", "Đoan Trang"]
tts = Vieneu()
for i, n in enumerate(names):
    t = time.time()
    audio = tts.infer(text, voice=n)
    path = f"{out}\\vieneu_{i}.wav"
    tts.save(audio, path)
    d = len(audio) / 48000
    print(f"OK {n} -> vieneu_{i}.wav dur={d:.2f}s time={time.time()-t:.2f}s", flush=True)
