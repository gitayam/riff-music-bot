setcpm(80/4)

stack(
  sound("bd ~ ~ ~ sd ~ ~ ~").bank("RolandTR909").gain(0.8).lpf(900).room(0.2),
  sound("~ hh ~ hh ~ hh ~ oh").bank("RolandTR909").gain(0.35).lpf(3200).room(0.4).swingBy(0.08),
  note("c2 ~ ~ g1 eb2 ~ ~ bb1").gain(0.5).lpf(700).lpenv(0.3).room(0.25),
  note("c4 eb4 g4 bb4 ~ ~ ~ ~").slow(2).gain(0.22).lpf(1800).room(0.7).delay(0.2),
  note("g4 ~ eb4 ~ f4 ~ d4 ~").slow(2).gain(0.14).lpf(2200).room(0.6).delay(0.25)
)
