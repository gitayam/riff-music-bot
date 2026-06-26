setcpm(110/4)
cat(
  stack(sound("bd*4").bank("RolandTR909"), note("c2 eb2 g2 c3").sound("sawtooth").lpf(700)),
  stack(sound("bd*4 sd").bank("RolandTR909"), n("0 2 4").scale("C:minor").sound("piano"))
)
