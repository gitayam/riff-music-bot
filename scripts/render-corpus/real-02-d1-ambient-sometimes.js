setcpm(80/4)

stack(
  sound("bd*2 sd*2").bank("RolandTR909").gain(0.85).lpf(1200).room(0.2),
  sound("hh*8").bank("RolandTR909").gain(0.22).lpf(5000).struct("x [~ x] x [x ~] x [~ x] x [x ~]").swingBy(0.08, 8).room(0.35),
  sound("oh*2").bank("RolandTR909").gain(0.18).lpf(4200).struct("~ x ~ x").room(0.45),
  note("c3 ~ eb3 ~ g3 ~ bb2 ~").gain(0.32).lpf(1800).lpenv(0.25).room(0.55).delay(0.2),
  n("0 2 4 6").scale("C:minor").slow(2).gain(0.24).lpf(1400).room(0.6).sometimes(x => x.delay(0.25)),
  note("c5 ~ g4 ~ eb5 ~ d5 ~").slow(2).gain(0.12).hpf(900).lpf(2600).room(0.7).delay(0.35)
)
