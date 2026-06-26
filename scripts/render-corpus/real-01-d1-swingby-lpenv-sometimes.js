setcpm(120/4)

stack(
  sound("bd*4").bank("RolandTR909").gain(1),
  sound("hh*8").bank("RolandTR909").gain(0.6).hpf(7000).swingBy(0.06),
  sound("sd*2").bank("RolandTR909").gain(0.8).room(0.15),
  sound("oh*4").bank("RolandTR909").gain(0.4).struct("0 0 1 0"),
  note("c2 c2 eb2 g2").gain(0.9).lpf(900).lpenv(0.2),
  n("0 2 4 6 4 2 7 6").scale("C:minor").gain(0.55).lpf(2200).delay(0.2),
  note("g4 bb4 c5 eb5").gain(0.35).room(0.4).sometimes(x => x.fast(2))
).swing()
