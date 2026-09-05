// Solid ribbon routes. Every theme preserves horizontal mouths and exact
// connection coordinates; drawing style never changes quantitative widths.
const point = ([x,y]) => `${x} ${y}`;

export function sweepChannel(x0, y0, x1, y1, thickness = 0, theme = "smooth", maximumThickness = thickness) {
  const span = x1-x0, rise = y1-y0;
  if (theme === "s-bend") {
    const points = [[x0,y0], [x0+span*.85,y0], [x0+span*.15,y1], [x1,y1]];
    return { points, path: `M ${point(points[0])} C ${points.slice(1).map(point).join(" ")}` };
  }
  if (theme === "zigzag") {
    const amplitude = Math.min(20,Math.abs(span)*.09);
    const points = [[x0,y0],[x0+span*.12,y0],
      [x0+span*.3,y0+rise*.25-amplitude], [x0+span*.5,y0+rise*.5+amplitude],
      [x0+span*.7,y0+rise*.75-amplitude], [x0+span*.88,y1],[x1,y1]];
    return { points, path: `M ${points.map(point).join(" L ")}` };
  }
  if (theme === "staircase") {
    const points = [[x0,y0]];
    for (const fraction of [.25,.5,.75]) {
      const before = (fraction-.25)/.75, after = fraction/.75;
      points.push([x0+span*fraction,y0+rise*before],[x0+span*fraction,y0+rise*after]);
    }
    points.push([x1,y1]);
    return { points, path: `M ${points.map(point).join(" L ")}` };
  }
  if (theme === "angular") {
    const points = [[x0,y0], [x0+span*.22,y0], [x0+span*.78,y1], [x1,y1]];
    return { points, path: `M ${points.map(point).join(" L ")}` };
  }
  if (theme === "terraced") {
    const middle = (y0+y1)/2;
    const points = [[x0,y0], [x0+span*.16,y0], [x0+span*.38,middle], [x0+span*.62,middle], [x0+span*.84,y1], [x1,y1]];
    return { points, path: bendFeedback(points, Math.min(24,Math.abs(span)*.07)) };
  }
  if (theme === "circuit") {
    // Opposing flows take different elbows instead of sharing a vertical
    // run, which would make their crossing look like a merge.
    const middle = x0 + span * (rise > 0 ? .34 : rise < 0 ? .66 : .5);
    const points = [[x0,y0], [middle,y0], [middle,y1], [x1,y1]];
    return { points, path: bendFeedback(points, Math.min(Math.abs(span)*.18,Math.max(18,maximumThickness*.6))) };
  }
  // A shared displacement keeps adjacent branches together. Limit curvature
  // using the widest channel so thick ribbons do not curl into tight folds.
  const amplitude = theme === "wiggly" ? Math.min(26, Math.abs(span)*.12, span*span/(Math.max(1,maximumThickness)*22))
    : theme === "ripple" ? Math.min(12, Math.abs(span)*.08, span*span/(Math.max(1,maximumThickness)*65))
    : ["arc","dip","sail"].includes(theme) ? Math.min(58,Math.abs(span)*.26) : 0;
  function sample(t) {
    const ease = t*t*t*(10+t*(-15+6*t));
    const easeSlope = 30*t*t*(1-t)*(1-t);
    const s = Math.sin(Math.PI*t), c = Math.cos(Math.PI*t);
    const frequency = (theme === "ripple" ? 4 : 2)*Math.PI;
    let wave, waveSlope;
    if (theme === "sail") {
      // t²(1-t)^4 peaks at t=1/3; scaling makes its height comparable to Arc.
      const k = 729/16;
      wave = -amplitude*k*t*t*(1-t)**4;
      waveSlope = -amplitude*k*(2*t*(1-t)**4-4*t*t*(1-t)**3);
    } else if (theme === "arc" || theme === "dip") {
      const sign = theme === "arc" ? -1 : 1;
      wave = sign*amplitude*s*s;
      waveSlope = sign*amplitude*2*Math.PI*s*c;
    } else {
      wave = amplitude*s*s*Math.sin(frequency*t);
      waveSlope = amplitude*(2*Math.PI*s*c*Math.sin(frequency*t)+frequency*s*s*Math.cos(frequency*t));
    }
    return { p:[x0+span*t,y0+rise*ease+wave], d:[span,rise*easeSlope+waveSlope] };
  }
  const points = [[x0,y0]];
  let path = `M ${x0} ${y0}`;
  // Hermite segments preserve analytic tangents, including at the mouths.
  const segments = amplitude ? 24 : 8;
  for (let i=0;i<segments;i++) {
    const a=sample(i/segments), b=sample((i+1)/segments), dt=1/(segments*3);
    const c0=[a.p[0]+a.d[0]*dt,a.p[1]+a.d[1]*dt];
    const c1=[b.p[0]-b.d[0]*dt,b.p[1]-b.d[1]*dt];
    const end=i===segments-1 ? [x1,y1] : b.p;
    path += ` C ${point(c0)} ${point(c1)} ${point(end)}`;
    points.push(c0,c1,end);
  }
  return { path, points };
}

export function bendFeedback(points, desiredRadius = 30) {
  let path = `M ${point(points[0])}`;
  for (let i=1;i<points.length-1;i++) {
    const a=points[i-1], b=points[i], c=points[i+1];
    const before=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const after=Math.hypot(c[0]-b[0],c[1]-b[1]);
    if (!before || !after) continue;
    const radius=Math.min(desiredRadius,before/2,after/2);
    const enter=[b[0]+(a[0]-b[0])*radius/before,b[1]+(a[1]-b[1])*radius/before];
    const exit=[b[0]+(c[0]-b[0])*radius/after,b[1]+(c[1]-b[1])*radius/after];
    path += ` L ${point(enter)} Q ${point(b)} ${point(exit)}`;
  }
  return path+` L ${point(points.at(-1))}`;
}

export function sharedTrunk(left, right, center, inlet, outlet, terminal) {
  const end=terminal ? right-28 : right;
  const span=end-left, bow=0;
  const top0=center-inlet/2, top1=center-outlet/2;
  const bottom0=center+inlet/2, bottom1=center+outlet/2;
  const middle=(left+end)/2;
  // The same bow on both boundaries keeps the shared trunk's width intact.
  const topMid=(top0+top1)/2+bow, bottomMid=(bottom0+bottom1)/2+bow;
  let path=`M ${left} ${top0} C ${left+span*.22} ${top0} ${left+span*.28} ${topMid} ${middle} ${topMid}`;
  path+=` C ${left+span*.72} ${topMid} ${left+span*.78} ${top1} ${end} ${top1}`;
  path+=terminal ? ` L ${right} ${center} L ${end} ${bottom1}` : ` L ${end} ${bottom1}`;
  path+=` C ${left+span*.78} ${bottom1} ${left+span*.72} ${bottomMid} ${middle} ${bottomMid}`;
  path+=` C ${left+span*.28} ${bottomMid} ${left+span*.22} ${bottom0} ${left} ${bottom0} Z`;
  return path;
}
