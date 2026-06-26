setcpm(120/4)
stack(
  sound("bd*4").bank("RolandTR909"),
  sound("~ cp ~ cp"),
  sound("hh*8").gain(0.4),
  note("c2 c2 eb2 g2").sound("sawtooth").lpf(800).gain(0.8),
  n("0 2 4 6").scale("C:minor").sound("piano").gain(0.4).room(0.3)
)
