import sys, time
from vieneu import Vieneu

out = sys.argv[1]
tts = Vieneu()
voices = tts.list_preset_voices()
print("VOICES:", len(voices))
for label, vid in voices:
    print(" -", label, "|", vid)
with open(out + "\\voices.txt", "w", encoding="utf-8") as f:
    for label, vid in voices:
        f.write(f"{label}\t{vid}\n")
