"""Run through Blender MCP, or Blender --background --python tools/build-actors.py.
Authors a separate scene and exports only its datablocks; never clears the open file.
Game coordinates: +Y up, +Z forward. Runtime meshes are merged per joint/palette slot.
"""
import bpy, math, json, os
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'models')
os.makedirs(OUT, exist_ok=True)
scene = bpy.data.scenes.new('ONISOLO • The Storm Court')
scene.render.engine = 'BLENDER_EEVEE'
scene.world = bpy.data.worlds.new('ONISOLO • Studio')
scene.world.color = (0.22, 0.22, 0.22)
collection = scene.collection
models = {}
buckets = {}
current = ''
materials = {}
JOINTS = {'hips':(0, .94, 0), 'torso':(0,.34,0), 'shoulders':(0,.56,0),
          'skirt':(0,-.32,0), 'head':(0,.84,0), 'armL':(-.48,.52,0),
          'armR':(.48,.52,0), 'legL':(-.18,-.38,0), 'legR':(.18,-.38,0),
          'sashL':(-.17,.38,-.32), 'sashR':(.17,.34,-.3), 'katana':(0,-.52,.06)}

def emit(part, verts, faces, value=.5, slot='', feature=''):
    key=(part,slot,feature)
    b=buckets.setdefault(key, {'vertices':[], 'faces':[], 'values':[]})
    offset=len(b['vertices']); b['vertices'].extend(verts)
    b['faces'].extend([tuple(offset+i for i in face) for face in faces])
    b['values'].extend([value]*len(faces))

def prism(part, center, size, value=.5, slot='', feature='', taper=1, rot=0):
    # Chamfered octagonal section: broad planes and crisp, shallow edge catches.
    w,h,d=size; c=.15
    ring=[(-.5+c,-.5),(.5-c,-.5),(.5,-.5+c),(.5,.5-c),(.5-c,.5),(-.5+c,.5),(-.5,.5-c),(-.5,-.5+c)]
    vs=[]
    for yy,sc in [(-h/2,1),(h/2,taper)]:
        for xx,zz in ring:
            x=xx*w*sc; z=zz*d*sc
            vs.append((center[0]+x*math.cos(rot)-yy*math.sin(rot),center[1]+x*math.sin(rot)+yy*math.cos(rot),center[2]+z))
    faces=[tuple(reversed(range(8))),tuple(range(8,16))]
    faces.extend([(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)])
    emit(part,vs,[tuple(reversed(f)) for f in faces],value,slot,feature)

def tube(part, points, radius, value=.5, slot='', feature='', sides=6, end=.3):
    vs=[]
    for j,p in enumerate(points):
        v=Vector(p); tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        tangent.normalize(); ref=Vector((0,0,1))
        if abs(tangent.dot(ref))>.95: ref=Vector((1,0,0))
        a=tangent.cross(ref).normalized(); b=tangent.cross(a).normalized()
        r=radius*(1-(1-end)*j/(len(points)-1))
        for i in range(sides):
            q=v+r*(a*math.cos(i*math.tau/sides)+b*math.sin(i*math.tau/sides)); vs.append(tuple(q))
    faces=[tuple(reversed(range(sides))),tuple(range((len(points)-1)*sides,len(points)*sides))]
    for j in range(len(points)-1):
        for i in range(sides): faces.append((j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i))
    emit(part,vs,faces,value,slot,feature)

def cloth(part, width, length, value, slot='', feature='', z=0, flare=.2):
    # Folded, double-sided fabric with alternating ridges and an uneven hem.
    vs=[]; n=8
    for row in range(3):
        for i in range(n+1):
            x=(i/n-.5)*(width+flare*row)
            y=-length*row/2 + (0.04*math.cos(i*2.1) if row==2 else 0)
            vs.append((x,y,z+(i%2)*.055-row*.05))
    faces=[]
    for r in range(2):
        for i in range(n):
            a=r*(n+1)+i; faces.append((a,a+1,a+n+2,a+n+1)); faces.append((a+n+1,a+n+2,a+1,a))
    emit(part,vs,faces,value,slot,feature)

def armor(part='torso', width=.67, rows=4, value=.62, slot='', feature='', z=.245):
    for i in range(rows):
        y=.25-i*.14
        prism(part,(0,y,z),(width+i*.025,.105,.12),value*(1-i*.035),slot,feature,taper=.92)
        for x in [-width*.32,width*.32]:
            prism(part,(x,y,.08+z),(.025,.12,.018),.88,'sash' if slot else '',feature,rot=.22 if x>0 else -.22)

def hat(part='head', radius=.64, height=.27, value=.70):
    n=16; vs=[(0,.22+height,0)]
    for rad,y in [(radius*.32,.22+height*.72),(radius,.22),(radius*.97,.195)]:
        vs.extend([(math.cos(i*math.tau/n)*rad,y,math.sin(i*math.tau/n)*rad) for i in range(n)])
    fs=[]
    for i in range(n):
        j=(i+1)%n; fs.extend([(0,1+i,1+j),(1+i,1+n+i,1+n+j,1+j),(1+n+i,1+2*n+i,1+2*n+j,1+n+j)])
    emit(part,vs,[tuple(reversed(f)) for f in fs],value)
    for i in range(0,n,2):
        a=i*math.tau/n; tube(part,[(math.cos(a)*radius*.18,.22+height*.91,math.sin(a)*radius*.18),(math.cos(a)*radius,.227,math.sin(a)*radius)],.01,.38)

def sword(kind='katana', enemy=False):
    part=kind if current=='player' else 'katana'
    length={'katana':1.28,'nodachi':2.05,'yari':2.75,'kanabo':1.58,'oni':1.75}.get(kind,1.28)
    if kind=='yumi':
        tube(part,[(0,-.78,0),(.28,-.48,0),(.35,.1,0),(.23,.72,0),(0,1.04,0)],.045,.54,end=1)
        tube(part,[(0,-.78,0),(-.09,.05,0),(0,1.04,0)],.008,.85,end=1,sides=3)
        prism(part,(.3,.07,0),(.1,.25,.09),.13)
        return
    if kind=='yari':
        tube(part,[(0,-.32,0),(0,2.12,0)],.034,.22,end=.8)
        tube(part,[(0,1.9,0),(0,2.12,0)],.052,.65,end=1)
        emit(part,[(-.13,2.05,0),(0,2.75,0),(.13,2.05,0),(0,2.08,.055),(0,2.08,-.055)],[(0,1,3),(3,1,2),(0,4,1),(4,2,1),(0,3,2,4)],.83,'steel')
        return
    if kind=='kanabo':
        tube(part,[(0,-.23,0),(0,1.6,0)],.14,.28,end=1.45,sides=8)
        for y in [.52,.82,1.12,1.42]:
            for side in [-1,1]: prism(part,(side*.21,y,0),(.13,.1,.12),.64,'steel',taper=.5)
    else:
        wide=.115 if kind=='katana' else .20
        vs=[]; n=12
        for i in range(n+1):
            t=i/n; bend=.16*t*t*(1.5 if kind=='nodachi' else 1)
            width=wide*(1-.52*t) if i<n else .004
            y=.14+t*length
            vs.extend([(bend-width*.5,y,-.022),(bend+width*.5,y,-.013),(bend+width*.5,y,.013),(bend-width*.5,y,.022)])
        fs=[]
        for i in range(n):
            for s in range(4): fs.append((i*4+s,i*4+(s+1)%4,(i+1)*4+(s+1)%4,(i+1)*4+s))
        fs.extend([(3,2,1,0),tuple(range(n*4,n*4+4))])
        emit(part,vs,[tuple(reversed(f)) for f in fs],.70 if enemy else .96,'steel')
        tube(part,[(.016,.17,.025),(.045,length*.5,.024),(.14,length+.1,.024)],.008,.99,'steel',end=.15,sides=3)
    prism(part,(0,.1,0),(.32,.047,.22),.64 if not enemy else .36)
    prism(part,(0,-.09,0),(.09,.32,.085),.10)
    for i in range(5): prism(part,(0,-.21+i*.055,.045),(.07,.023,.012),.82,rot=.42 if i%2 else -.42)
    prism(part,(0,-.265,0),(.105,.055,.09),.66)

def base(player=False, bulky=False):
    body=.37 if player else .34; width=.79 if bulky else .65
    prism('torso',(0,0,0),(width,.68,.44),body,'armor' if player else '',taper=1.05)
    prism('torso',(0,-.29,0),(width+.04,.13,.48),.14,'trim' if player else '')
    for side in [-1,1]:
        prism('torso',(side*.12,.17,.25),(.075,.52,.035),.8 if player else .62,'sash' if player else '',rot=side*.55)
    for part,side in [('armL',-1),('armR',1)]:
        prism(part,(0,-.20,0),(.25,.42,.30),body,'armor' if player else '',taper=1.2)
        prism(part,(0,-.43,.015),(.17,.16,.20),.64,'skin' if player else '')
        for y in [-.27,-.34]: prism(part,(0,y,.12),(.22,.047,.07),.72,'plate' if player else '')
    for part in ['legL','legR']:
        prism(part,(0,-.24,0),(.23,.45,.25),.23,'cloth' if player else '',taper=1.12)
        prism(part,(0,-.47,.055),(.27,.09,.4),.12,'trim' if player else '')
        prism(part,(0,-.43,.09),(.26,.055,.24),.66,'sash' if player else '')
    prism('skirt',(0,.14,0),(.58,.39,.39),.25,'cloth' if player else '')
    prism('skirt',(0,.27,0),(.69,.115,.45),.16,'trim' if player else '')
    prism('skirt',(.16,.24,.26),(.12,.14,.10),.75,'sash' if player else '')
    cloth('skirt',.62,.55,.3,'cloth' if player else '',z=.23,flare=.16)
    cloth('skirt',.62,.55,.27,'cloth' if player else '',z=-.19,flare=.16)
    prism('head',(0,0,0),(.32,.38,.33),.72,'skin' if player else '',taper=1.06)
    prism('head',(0,-.005,.185),(.13,.07,.075),.65,'skin' if player else '',taper=.6)
    for x in [-.095,.095]: prism('head',(x,.065,.176),(.08,.035,.014),.05,'trim' if player else '')

def player_model():
    base(True); armor(slot='plate')
    # Split kusazuri and fitted gauntlets retain readable negative space.
    for x in [-.28,0,.28]:
        for i in range(3): prism('skirt',(x,-.05-i*.14,.30),(.235,.12,.085),.65-i*.06,'plate',taper=.9)
    for part in ['sashL','sashR']: cloth(part,.14,.87,.96,'sash','warSash',flare=.015)
    for part in ['armL','armR']:
        for i in range(3): prism(part,(0,-.03-i*.13,.01),(.42,.12,.40),.75,'plate','armoredShoulders',taper=.95)
        cloth(part,.42,.56,.8,'armor','lightSleeves',z=-.1,flare=.025)
    prism('head',(0,.15,-.015),(.4,.21,.39),.12,'trim','wildHair',taper=.84)
    for x,z,lean in [(-.18,0,-.7),(-.1,-.12,-.25),(.04,-.16,.2),(.16,-.02,.6)]:
        tube('head',[(x,.23,z),(x+lean*.18,.46,z-.08),(x+lean*.26,.50,z-.17)],.09,.2,'trim','wildHair',sides=5,end=.05)
    for feature in ['ponytail','mibuHeadband']:
        prism('head',(0,.15,-.03),(.38,.19,.4),.15,'trim',feature,taper=.8)
        prism('head',(0,.11,.185),(.36,.05,.04),.98,'sash',feature)
        tube('head',[(0,.23,-.14),(0,.34,-.3),(0,.02,-.43),(0,-.24,-.38)],.065,.18,'trim',feature,end=.3)
    # Kabuto bowl, stacked neck guard, sculpted menpo, and curved moon crest.
    for i in range(3): prism('head',(0,.0-i*.075,-.07),(.58+i*.08,.1,.50+i*.06),.6,'armor','kabuto',taper=.85)
    prism('head',(0,.23,0),(.51,.34,.5),.8,'armor','kabuto',taper=.58)
    prism('head',(0,.12,.24),(.55,.065,.20),.92,'plate','kabuto')
    prism('head',(0,-.08,.20),(.37,.16,.12),.45,'trim','kabuto',taper=.75)
    for side in [-1,1]:
        pts=[(side*(.09+.47*math.sin(t*math.pi/2)),.29+.37*(1-math.cos(t*math.pi/2)),.24) for t in [0,.25,.5,.75,1]]
        tube('head',pts,.055,.99,'crest','dragonCrescent',end=.05)
    prism('head',(-.09,.045,.23),(.14,.08,.045),.13,'trim','dragonCrescent')
    cloth('torso',.89,1.0,.99,'plate','mibuHaori',z=-.25,flare=.10)
    for x in [-.36,-.18,0,.18,.36]:
        emit('torso',[(x-.07,-.77,-.39),(x+.07,-.77,-.39),(x,-.53,-.38)],[(0,1,2),(2,1,0)],.22,'armor','mibuHaori')
    tube('torso',[(-.42,-.30,-.08),(-.8,-.34,-.44),(-1,-.39,-.78)],.065,.2,'trim','dualSword',end=.65)
    sword('katana'); sword('nodachi')

def enemy_model(kind):
    bulky=kind in ('brute','oni'); base(bulky=bulky)
    if kind=='ronin':
        hat(); cloth('torso',.82,.68,.57,z=-.26,flare=.13)
        for x in [-.3,-.1,.1,.3]: tube('torso',[(x,.30,-.28),(x*1.25,-.44,-.32)],.035,.43,end=.3)
    elif kind=='hunter':
        prism('head',(0,.15,-.03),(.38,.2,.38),.16,taper=.75)
        prism('head',(0,-.09,.18),(.35,.17,.065),.2)
        tube('head',[(0,.22,-.11),(.0,.39,-.3),(.07,.2,-.44)],.085,.23,end=.08)
        cloth('torso',.30,.80,.83,z=-.27,flare=.06)
        for side in [-1,1]: prism('torso',(side*.29,.0,.24),(.05,.55,.025),.75,rot=side*.6)
    elif kind=='yari':
        prism('head',(0,.23,0),(.36,.3,.40),.31,taper=.38)
        tube('head',[(0,.35,-.05),(0,.58,-.10),(0,.77,-.2)],.04,.82,end=.02)
        armor(width=.58,rows=3,value=.52)
        cloth('torso',.15,.8,.81,z=-.29,flare=.05)
    elif kind=='yumi':
        hat(radius=.44,height=.42,value=.61)
        prism('torso',(-.31,.13,-.36),(.25,.66,.25),.22,rot=-.2)
        for i in range(4):
            x=-.4+i*.055
            tube('torso',[(x,.17,-.38),(x-.07,.74,-.38)],.012,.78,end=1,sides=4)
            prism('torso',(x-.06,.62,-.38),(.05,.16,.05),.82,rot=.1)
        armor(width=.55,rows=2,value=.49)
    else:
        armor(width=.79,rows=5,value=.49 if kind=='brute' else .68)
        for part,side in [('armL',-1),('armR',1)]:
            for i in range(3): prism(part,(side*.06,-i*.14,0),(.47,.13,.51),.54-i*.045,taper=.88)
        prism('head',(0,-.07,.17),(.44,.28,.20),.77,taper=.76)
        for side in [-1,1]:
            tube('head',[(side*.15,.14,.01),(side*.27,.35,-.03),(side*.25,.61,-.08)],.09,.80,end=.02)
            tube('head',[(side*.16,-.10,.29),(side*.16,.055,.31)],.033,.96,end=.03)
            prism('head',(side*.105,.05,.285),(.12,.035,.018),.98)
            prism('head',(side*.13,.115,.245),(.2,.075,.12),.26,rot=side*.25)
        if kind=='oni':
            for i in range(5): prism('head',(0,.18-i*.09,-.19),(.62+i*.04,.095,.43),.44,taper=.91)
            cloth('torso',1.05,1.12,.29,z=-.33,flare=.12)
            for side in [-1,1]: tube('torso',[(side*.48,.38,-.1),(side*.7,.60,-.15),(side*.77,.73,-.23)],.085,.8,end=.02)
    sword({'brute':'kanabo','oni':'oni'}.get(kind,kind if kind in ('yari','yumi') else 'katana'),True)

def build(name):
    global buckets,current
    current=name; buckets={}
    if name=='player': player_model()
    else: enemy_model(name)
    model=[]; idx=list(['player','ronin','hunter','yari','yumi','brute','oni']).index(name)
    off=(idx-3)*2.8
    for (part,slot,feature),b in buckets.items():
        mesh=bpy.data.meshes.new('ONISOLO / '+name+' / '+part+' / '+(feature or slot or 'ink'))
        # Three x,y,z -> Blender x,-z,y. The winding remains right-handed.
        mesh.from_pydata([(x,-z,y) for x,y,z in b['vertices']],[],b['faces']); mesh.update()
        obj=bpy.data.objects.new(mesh.name,mesh); collection.objects.link(obj)
        joint=JOINTS.get(part,(0,0,0)); hip=JOINTS['hips']
        if part in ('katana','nodachi'):
            # Preview carried steel; runtime mounts beneath the animated hand.
            obj.location=(off+.65,-.2,1.0)
        else: obj.location=(off+joint[0],-joint[2],hip[1]+joint[1])
        obj['joint']=part; obj['palette']=slot; obj['feature']=feature; obj['model']=name
        obj.hide_render=bool((feature and feature not in ('wildHair','warSash','dualSword')) or part=='nodachi')
        attr=mesh.color_attributes.new(name='Ink',type='FLOAT_COLOR',domain='CORNER')
        for poly,val in zip(mesh.polygons,b['values']):
            for li in poly.loop_indices: attr.data[li].color=(val,val,val,1)
        mat=bpy.data.materials.get('ONISOLO / Vertex ink')
        if not mat:
            mat=bpy.data.materials.new('ONISOLO / Vertex ink'); mat.use_nodes=True
            nodes=mat.node_tree.nodes; shader=nodes.get('Principled BSDF'); col=nodes.new('ShaderNodeVertexColor'); col.layer_name='Ink'
            mat.node_tree.links.new(col.outputs['Color'],shader.inputs['Base Color']); shader.inputs['Roughness'].default_value=.72
        mesh.materials.append(mat)
        mesh.calc_loop_triangles()
        # Quantized flat triangles are tiny on the wire, need no decoder, and
        # eliminate both a model loader and asynchronous animation race.
        positions=[]; shades=[]
        for tri in mesh.loop_triangles:
            for vi in tri.vertices:
                v=mesh.vertices[vi].co; positions.extend([round(v.x*10000),round(v.z*10000),round(-v.y*10000)])
            shades.append(round(b['values'][tri.polygon_index]*255))
        model.append({'joint':part,'slot':slot,'feature':feature,'p':positions,'c':shades})
    models[name]=model

for name in ['player','ronin','hunter','yari','yumi','brute','oni']: build(name)
# Contact-sheet camera, independent from the user's existing scene.
camdata=bpy.data.cameras.new('ONISOLO / Portrait camera'); cam=bpy.data.objects.new(camdata.name,camdata); collection.objects.link(cam)
cam.location=(8,-19,13); target=Vector((0,0,1)); cam.rotation_euler=(target-Vector(cam.location)).to_track_quat('-Z','Y').to_euler(); camdata.type='ORTHO'; camdata.ortho_scale=23; scene.camera=cam
for name,loc,power,size in [('Key',(-8,-10,14),2400,8),('Rim',(5,4,10),1800,7)]:
    ld=bpy.data.lights.new('ONISOLO / '+name,'AREA'); lo=bpy.data.objects.new(ld.name,ld); collection.objects.link(lo); lo.location=loc; lo.rotation_euler=(Vector((0,0,1))-Vector(loc)).to_track_quat('-Z','Y').to_euler(); ld.energy=power; ld.shape='DISK'; ld.size=size
scene.render.resolution_x=1800; scene.render.resolution_y=700; scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'; scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=True
payload='// Generated by tools/build-actors.py through Blender MCP. Do not hand edit.\nexport const ACTOR_MESHES = '+json.dumps(models,separators=(',',':'))+';\n'
with open(os.path.join(OUT,'storm-court.js'),'w') as f: f.write(payload)
manifest={'generator':'Blender '+bpy.app.version_string,'coordinateSystem':'Y up, +Z forward','models':{k:{'meshes':len(v),'triangles':sum(len(p['c']) for p in v)} for k,v in models.items()},'runtimeBytes':len(payload.encode())}
with open(os.path.join(OUT,'manifest.json'),'w') as f: json.dump(manifest,f,indent=2)
if bpy.context.window: bpy.context.window.scene=scene
if bpy.app.background:
    # A dedicated background process saves the source without touching another project.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'storm-court.blend'), compress=True)
if bpy.context.window: bpy.context.window.scene=scene
result=manifest
