import math
C=50
GRAD='''<linearGradient id="{id}" gradientUnits="userSpaceOnUse" x1="14" y1="86" x2="86" y2="14">
  <stop offset="0" stop-color="#14c3ea"/><stop offset="0.5" stop-color="#3a7df6"/><stop offset="1" stop-color="#7b57f2"/></linearGradient>'''
def pol(r,a):  # a: degrees, 0 = up, clockwise
    t=math.radians(a); return (C+r*math.sin(t), C-r*math.cos(t))
def spike(a, r0, r1, w):
    tip=pol(r1,a); b=pol(r0,a); t=math.radians(a); px,py=math.cos(t),math.sin(t)  # perpendicular
    l=(b[0]-px*w/2, b[1]-py*w/2); r=(b[0]+px*w/2, b[1]+py*w/2)
    return f"M{tip[0]:.2f},{tip[1]:.2f}L{l[0]:.2f},{l[1]:.2f}L{r[0]:.2f},{r[1]:.2f}Z"
def ring(r, sw): return f'<circle cx="50" cy="50" r="{r}" fill="none" stroke-width="{sw}"/>'
def compass(gid, full=True):
    card=[spike(0,16.5,47,10.5),spike(180,16.5,47,10.5),spike(90,20.5,48,10.5),spike(270,20.5,48,10.5)]
    diag=[spike(a,27.8,44,4.4) for a in (45,135,225,315)] if full else []
    spikes=card+diag
    mid=f"m{gid}"
    ks = 2.6 if full else 3.4
    s=f'''<mask id="{mid}o" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>
  <path d="{' '.join(spikes)}" fill="#000" stroke="#000" stroke-width="{ks}" stroke-linejoin="round"/></mask>
<mask id="{mid}i" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>
  <path d="{' '.join(card)}" fill="#000" stroke="#000" stroke-width="{ks}" stroke-linejoin="round"/></mask>
<g stroke="url(#{gid})" mask="url(#{mid}o)">{ring(37.8,4.6)}</g>
{f'<g stroke="url(#{gid})" mask="url(#{mid}i)">{ring(27.8,2.7)}</g>' if full else ''}
<path d="{' '.join(spikes)}" fill="url(#{gid})"/>'''
    return s
def pon(gid):
    # P, o, n（線の太さ 4.6）。「o」の右上から「n」の左の脚へつながる形
    sw=4.1
    return f'''<g fill="none" stroke="url(#{gid})" stroke-width="{sw}" stroke-linecap="butt" stroke-linejoin="round">
  <path d="M32.4,61.6V38.3H37.6a6.9,6.9 0 0 1 0,13.8H32.4"/>
  <circle cx="48.3" cy="55.3" r="6.2"/>
  <path d="M54.5,55.3V49.4a6.8,6.8 0 0 1 13.6,0V61.6"/>
</g>'''
def P_only(gid):
    return f'''<path d="M44.2,62V38H50a7,7 0 0 1 0,14H44.2" fill="none" stroke="url(#{gid})" stroke-width="6.4" stroke-linejoin="round"/>'''
def svg(body, defs, view="0 0 100 100"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"><defs>{defs}</defs>{body}</svg>\n'
def tile(inner, pad=6, border=True):
    return f'''<rect x="{pad}" y="{pad}" width="{100-2*pad}" height="{100-2*pad}" rx="{(100-2*pad)*0.22:.1f}" fill="#fff"{' stroke="#dde2ee" stroke-width="1.2"' if border else ''}/>
<g transform="translate(50 50) scale({(100-2*pad)/100*0.86:.3f}) translate(-50 -50)">{inner}</g>'''

# ---- 文字「Pon」：参照画像（黒のワードマーク）をなぞった形（P・o・n の間の細い線も含む）----
import re as _re
_w=open('trace/word.svg').read()
WORD_G=_w[_w.index('<g transform'):_w.rindex('</g>')+4].replace('fill="#000000"','fill="#fff"')
_x0,_y0,_W,_H=[float(v) for v in open('trace/word_meta.txt').read().split()]
def word_in_compass():
    s=40.5/_W; tx=30.2; ty=50.15-_H*s/2
    return f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.6f}) translate({-_x0} {-_y0})">{WORD_G}</g>'
def logo(uid, full=True):
    card=[spike(0,16.5,47,10.5),spike(180,16.5,47,10.5),spike(90,20.5,48,10.5),spike(270,20.5,48,10.5)]
    diag=[spike(a,27.8,44,4.4) for a in (45,135,225,315)]
    ks=2.6
    grad=f'''<linearGradient id="{uid}g" gradientUnits="userSpaceOnUse" x1="14" y1="86" x2="86" y2="14"><stop offset="0" stop-color="#14c3ea"/><stop offset="0.5" stop-color="#3a7df6"/><stop offset="1" stop-color="#7b57f2"/></linearGradient>'''
    m=f'''<mask id="{uid}m" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
<circle cx="50" cy="50" r="37.8" fill="none" stroke="#fff" stroke-width="4.6"/>
<path d="{' '.join(card+diag)}" fill="#000" stroke="#000" stroke-width="{ks}" stroke-linejoin="round"/>
<circle cx="50" cy="50" r="27.8" fill="none" stroke="#fff" stroke-width="2.7"/>
<path d="{' '.join(card)}" fill="#000" stroke="#000" stroke-width="{ks}" stroke-linejoin="round"/>
<path d="{' '.join(card+diag)}" fill="#fff"/>
{word_in_compass()}</mask>'''
    return grad+m, f'<rect width="100" height="100" fill="url(#{uid}g)" mask="url(#{uid}m)"/>'

g=GRAD.format(id='g')
d,b=logo('ponl'); open('pon-logo.svg','w').write(svg(b,d))                       # 画面の左上・印刷用（背景なし）
d,b=logo('poni'); open('pon-icon.svg','w').write(svg(tile(b),d))                 # 48・128（白い角丸つき）
open('pon-icon-small.svg','w').write(svg(tile(compass('g',False)+P_only('g'),pad=3,border=False),g))  # 16・32（簡単な形）
d,b=logo('ponf'); open('pon-icon-full.svg','w').write(svg('<rect width="100" height="100" fill="#fff"/>'+f'<g transform="translate(50 50) scale(0.8) translate(-50 -50)">{b}</g>',d))  # ホーム画面・マスク用
print('ok')

def small(gid, px):
    # 16・32用：線を太く、形を少なく（外の輪と4方向の針と「P」だけ）
    sw = 10 if px <= 16 else 8
    card=[spike(0,22,49,15),spike(180,22,49,15),spike(90,22,49,15),spike(270,22,49,15)]
    p=f'''<mask id="ms{px}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect width="100" height="100" fill="#fff"/>
  <path d="{' '.join(card)}" fill="#000" stroke="#000" stroke-width="{5 if px<=16 else 4}" stroke-linejoin="round"/></mask>
<g stroke="url(#{gid})" mask="url(#ms{px})"><circle cx="50" cy="50" r="{36}" fill="none" stroke-width="{sw}"/></g>
<path d="{' '.join(card)}" fill="url(#{gid})"/>
<path d="{'M42,64V36H51a8,8 0 0 1 0,16H42' if px>16 else 'M41,66V34H51a9,9 0 0 1 0,18H41'}" fill="none" stroke="url(#{gid})" stroke-width="{9 if px>16 else 11}" stroke-linejoin="round"/>'''
    return p
for px in (16,32):
    body=f'''<rect x="1" y="1" width="98" height="98" rx="22" fill="#fff"/>
<g transform="translate(50 50) scale(0.9) translate(-50 -50)">{small('g',px)}</g>'''
    open(f'pon-icon-{px}.svg','w').write(svg(body,g))

# 16用（さらに簡単に）：外の輪と、中心から伸びる4方向の針（コンパスの星）だけ
star = "M50,4L58,42L96,50L58,58L50,96L42,58L4,50L42,42Z"
body16=f'''<rect x="0" y="0" width="100" height="100" rx="22" fill="#fff"/>
<circle cx="50" cy="50" r="31" fill="none" stroke="url(#g)" stroke-width="12"/>
<path d="{star}" fill="url(#g)" stroke="#fff" stroke-width="4" stroke-linejoin="miter" paint-order="stroke"/>'''
open('pon-icon-16.svg','w').write(svg(body16,g))
