setcpm(80/4)

stack(
  sound("bd ~ ~ bd").bank("RolandTR909").gain(0.8).lpf(900).room(0.15),
  sound("~ hh ~ hh").bank("RolandTR909").gain(0.35).lpf(3500).slow(2).room(0.3),
  sound("~ ~ sd ~").bank("RolandTR909").gain(0.45).lpf(1800).room(0.25),
  note("c3 eb3 g3 bb3").slow(2).gain(0.4).lpf(1400).room(0.45).delay(0.2),
  n("0 2 4 6").scale("C:minor").slow(4).gain(0.25).lpf(2200).room(0.5).delay(0.35)
)
