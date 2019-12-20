
// Some general structure inspired by
// https://github.com/spite/THREE.MeshLine/blob/master/src/THREE.MeshLine.js

;(function() {
    
    "use strict";
    
    var root = this;
    
    var has_require = typeof require !== 'undefined';
    
    var THREE = root.THREE || has_require && require('three');
    if( !THREE ) {
        throw new Error( 'THREE.contourist requires three.js' );
    }

    // Test if samples have value in range or crossing range.
    var inrange = function(limits, samples) {
        var low_limit = limits[0];
        var high_limit = limits[1];
        var below = false;
        var above = false;
        for (var i=0; i<samples.length; i++) {
            var si = samples[i];
            // null is always out of range (no value)
            if (si == null) {
                return false;
            }
            if (si < low_limit) {
                below = true;
            } else {
                if (si > high_limit) {
                    above = true;
                } else {
                    return true;  // shortcut: point in range
                }
            }
        }
        return (below && above);  // samples cross limits.
    }

    // Estimate a bounding sphere from a point list
    var estimate_bounding_sphere = function(flattened_points) {
        // probably buggy but better than nothing
        var mins = [flattened_points[0], flattened_points[1], flattened_points[2]];
        var maxes = [flattened_points[0], flattened_points[1], flattened_points[2]];
        for (var i=0; i<flattened_points.length; i+=3) {
            var xyz = [flattened_points[i+0], flattened_points[i+1], flattened_points[i+2]];
            for (var j=0; j<3; j++) {
                mins[j] = Math.min(mins[j], xyz[j]);
                maxes[j] = Math.max(maxes[j], xyz[j]);
            }
        }
        var maxmax = Math.max(Math.max(maxes[0], maxes[1]), maxes[2]);
        var radius = maxmax * 0.5;
        var center = new THREE.Vector3(
                            (maxes[0] + mins[0]) * 0.5, 
                            (maxes[1] + mins[1]) * 0.5, 
                            (maxes[2] + mins[2]) * 0.5);
        var result = new THREE.Sphere();
        result.radius = radius;
        result.center = center;
        return result;
    };
    
    var extremum = function(numArray, mnmx) {
        var result = null;  // apply blows out the stack.
        for (var i=1; i<numArray.length; i++) {
            var nA = numArray[i];
            if (nA != null) {
                if (result == null) {
                    result = nA;
                } else {
                    result = mnmx(result, numArray[i]);
                }
            }
        }
        return result;
    };

    var default_vector3 = function(x, a, b, c) {
        if (x) {
            if (!Array.isArray(x)) {
                return x;
            }
            a = x[0]; b = x[1]; c = x[2];
        }
        return new THREE.Vector3(a, b, c);
    }

    var Irregular3D_Declarations = `
    uniform float f0;
    uniform float delta;

    attribute vec3 A;
    attribute vec3 B;
    attribute vec3 C;
    attribute vec3 D;
    attribute vec4 fABCD;
    attribute float triangle;
    attribute float point_index;
    `;
    
    var Regular3D_Declarations = `
    uniform float f0;
    uniform vec3 origin, u_dir, v_dir, w_dir;

    attribute vec3 ijk, indices;
    attribute vec4 fbuffer_w0, fbuffer_w1;
    `; 

    var Slicer_Declarations = `
    // Slicer declarations
    uniform vec3 plane_point, plane_normal, origin, u_dir, v_dir, w_dir;
    attribute vec3 ijk, indices, c_color;

    float plane_offset(in vec3 xyz) {
        //return xyz.z - 0.5; // DEBUG!!!
        vec3 from_plane_point = xyz - plane_point;
        return dot(from_plane_point, plane_normal);
    }
    `;

    var Irregular3D_Core = `
    visible = 0.0;  // default to invisible.
    vec3 override_vertex = vec3(0, 0, 0);  // degenerate default.
    vec3 override_normal = vec3(0, 1, 0);  // arbitrary default.

    // micro-optimization shortcut
    if (abs(delta) < 1e-5) {
        if (((fABCD[0] < f0) && (fABCD[1] < f0) && (fABCD[2] < f0) && (fABCD[3] < f0)) ||
            ((fABCD[0] >= f0) && (fABCD[1] >= f0) && (fABCD[2] >= f0) && (fABCD[3] >= f0))) {
            visible = 0.0;
            // no visible triangle: skip the rest
            return;
        }
    }
    //float triangle = position[0];  // 0 or 1
    //float point_index = position[1]; // 0, 1, or 2
    // bubble sort ABCD on fABCD values
    mat4 sorter;
    sorter[0] = vec4(A, fABCD[0]);
    sorter[1] = vec4(B, fABCD[1]);
    sorter[2] = vec4(C, fABCD[2]);
    sorter[3] = vec4(D, fABCD[3]);
    vec4 save;
    for (int iter=0; iter<3; iter++) {
        for (int i=0; i<3; i++) {
            if (sorter[i][3] > sorter[i+1][3]) {
                save = vec4(sorter[i]);
                sorter[i] = sorter[i+1];
                sorter[i+1] = save;
            }
        }
    }
    // unpack sorted data
    vec3 AA = vec3(sorter[0][0], sorter[0][1], sorter[0][2]);
    float fA = sorter[0][3];
    vec3 BB = vec3(sorter[1][0], sorter[1][1], sorter[1][2]);
    float fB = sorter[1][3];
    vec3 CC = vec3(sorter[2][0], sorter[2][1], sorter[2][2]);
    float fC = sorter[2][3];
    vec3 DD = vec3(sorter[3][0], sorter[3][1], sorter[3][2]);
    float fD = sorter[3][3];
    // find triangle vertices
    vec3 positive_direction = DD - AA;
    vec3 p1 = vec3(0, 0, 0);
    vec3 p2 = vec3(0, 0, 0);
    vec3 p3 = vec3(0, 0, 0);
    bool valid_triangle = false;
    bool two_triangles = false;
    float f0s = shift_cutoff(fA, fD, delta, f0);
    if (fA < f0s && fD > f0s) {
        // one or two triangles inside tetrahedron (A,B,C,D)
        if (fB < f0s) {
            if (fC < f0s) {
                // one triangle (DA, DB, DC)
                if (triangle < 0.5) {
                    valid_triangle = true;
                    interpolate0(DD, fD, AA, fA, f0s, delta, p2);
                    interpolate0(DD, fD, BB, fB, f0s, delta, p1);
                    interpolate0(DD, fD, CC, fC, f0s, delta, p3);
                }
            } else {
                // two vertices on each side of level set:
                // two triangles (AD, AC, BC), (AD, BD, BC)
                two_triangles = true;
                if (triangle < 0.5) {
                    valid_triangle = true;
                    interpolate0(AA, fA, DD, fD, f0s, delta, p1);
                    interpolate0(AA, fA, CC, fC, f0s, delta, p2);
                    interpolate0(BB, fB, CC, fC, f0s, delta, p3);
                } else {
                    valid_triangle = true;
                    interpolate0(AA, fA, DD, fD, f0s, delta, p1);
                    interpolate0(BB, fB, DD, fD, f0s, delta, p2);
                    interpolate0(BB, fB, CC, fC, f0s, delta, p3);
                }
            }
        } else {
            // one triangle (AB, AC, AD)
            if (triangle < 0.5) {
                valid_triangle = true;
                interpolate0(AA, fA, BB, fB, f0s, delta, p1);
                interpolate0(AA, fA, CC, fC, f0s, delta, p2);
                interpolate0(AA, fA, DD, fD, f0s, delta, p3);
            }
        }
    }
    if (valid_triangle) {
        if (two_triangles || (triangle < 0.5)) {
            visible = 1.0;
        }
        if (point_index < 0.5) {
            override_vertex = p1;
        } else {
            if (point_index > 1.5) {
                override_vertex = p3;
            } else {
                override_vertex = p2;
            }
        }
        // compute normal
        vec3 test_normal = normalize(cross(p2-p1, p3-p1));
        if (dot(test_normal, positive_direction) < 0.0) {
            override_normal = - test_normal;
            vec3 swap = p1;
            p1 = p2;
            p2 = swap;
        } else {
            override_normal = test_normal;
        }
    }
    `;

    var Regular3D_Core = `
    // micro-optimization shortcut
    bool all_above = true;
    bool all_below = true;
    for (int i=0; i<4; i++) {
        if (fbuffer_w0[i] < f0) { all_above = false; }
        if (fbuffer_w1[i] < f0) { all_above = false; }
        if (fbuffer_w0[i] >= f0) { all_below = false; }
        if (fbuffer_w1[i] >= f0) { all_below = false; }
    }
    if (all_above || all_below) {
        visible = 0.0;
        // skip the rest
        return;
    }

    float delta = 0.0;
    float f_origin = fbuffer_w0[0];
    float f_v = fbuffer_w0[1];
    float f_u = fbuffer_w0[2];
    float f_uv = fbuffer_w0[3];
    float f_w = fbuffer_w1[0];
    float f_vw = fbuffer_w1[1];
    float f_uw = fbuffer_w1[2];
    float f_uvw = fbuffer_w1[3];
    
    float i = ijk[0];
    float j = ijk[1];
    float k = ijk[2];
    
    // indices: vertex, triangle, tetra
    float tetrahedron = indices[2];
    float triangle = indices[1];
    float point_index = indices[0];
    
    vec3 A = origin + (i * u_dir) + (j * v_dir) + (k * w_dir);
    float f_A = f_origin;
    vec3 D = A + u_dir + v_dir + w_dir;
    float f_D = f_uvw;
    
    vec3 B, C;
    float f_B, f_C;
    if ((tetrahedron > -0.5) && (tetrahedron < 0.5)) {
        B = A + w_dir;
        f_B = f_w;
        C = A + v_dir + w_dir;
        f_C = f_vw;
    }
    if ((tetrahedron > 0.5) && (tetrahedron < 1.5)) {
        B = A + v_dir;
        f_B = f_v;
        C = A + v_dir + w_dir;
        f_C = f_vw;
    }
    if ((tetrahedron > 1.5) && (tetrahedron < 2.5)) {
        B = A + w_dir;
        f_B = f_w;
        C = A + u_dir + w_dir;
        f_C = f_uw;
    }
    if ((tetrahedron > 2.5) && (tetrahedron < 3.5)) {
        B = A + u_dir;
        f_B = f_u;
        C = A + u_dir + w_dir;
        f_C = f_uw;
    }
    if ((tetrahedron > 3.5) && (tetrahedron < 4.5)) {
        B = A + v_dir;
        f_B = f_v;
        C = A + u_dir + v_dir;
        f_C = f_uv;
    }
    if ((tetrahedron > 4.5) && (tetrahedron < 5.5)) {
        B = A + u_dir;
        f_B = f_u;
        C = A + u_dir + v_dir;
        f_C = f_uv;
    }
    vec4 fABCD = vec4(f_A, f_B, f_C, f_D);
    ` + Irregular3D_Core;  // XXXXX

    var Slicer_Core = `
    contourist_color = vec4(c_color, 1.0);
    //contourist_color = vec4(1,1,1,1);  // DEBUG!!
    float f0 = 0.0;
    vec3 ll = origin + ijk[0] * u_dir + ijk[1] * v_dir + ijk[2] * w_dir;
    vec4 fbuffer_w0 = vec4(
        plane_offset(ll), 
        plane_offset(ll + v_dir), 
        plane_offset(ll + u_dir), 
        plane_offset(ll + u_dir + v_dir)
    );
    vec4 fbuffer_w1 = vec4(
        plane_offset(ll + w_dir), 
        plane_offset(ll + v_dir + w_dir), 
        plane_offset(ll + u_dir + w_dir), 
        plane_offset(ll + u_dir + v_dir + w_dir)
    );
    ` + Regular3D_Core;

    var shader_program_start = 'void main() {';

    // added_initial calculations should define vec3's override_vertex and override_normal
    //   and also set visible to 1.0 or 0.0.
    var patch_vertex_shader = function(
        source_shader,
        added_global_declarations,
        added_initial_calculations,
        intensities
    ) {
        if (!source_shader.includes(shader_program_start)) {
            throw new Error("Cannot find program start in source shader for patching.");
        }
        var intensity_declaration = "";
        var color_calculation = "    contourist_color = vec4(1,1,1,1);"
        if (intensities) {
            intensity_declaration = "attribute float c_intensity;"
            //color_calculation = "    contourist_color = vec4(c_intensity, c_intensity, c_intensity, 1);"
            color_calculation = "    contourist_color = vec4((vec3(0,1,1) * c_intensity + vec3(1,0,1) * (1.0-c_intensity)), 1);"
        }
        var initial_patch = [
            added_global_declarations, 
            "varying float visible;  // contourist visibility flag.",
            "varying vec4 contourist_color; // contourist color",
            intensity_declaration,
            interpolate0code,
            shader_program_start, 
            color_calculation,
            added_initial_calculations
        ].join("\n");
        var patched_shader = source_shader.replace(shader_program_start, initial_patch);
        var begin_vertex = '#include <begin_vertex>';
        if (!patched_shader.includes(begin_vertex)) {
            throw new Error("Cannot find begin vertex in source shader for patching.");
        }
        var vertex_patch = [
            begin_vertex,
            "transformed = vec3(override_vertex); // contourist override"
        ].join("\n");
        patched_shader = patched_shader.replace(begin_vertex, vertex_patch);
        var beginnormal_vertex = '#include <beginnormal_vertex>';
        if (patched_shader.includes(beginnormal_vertex)) {
            var normal_patch = [
                beginnormal_vertex,
                "objectNormal = vec3(override_normal); // contourist override"
            ].join("\n");
            patched_shader = patched_shader.replace(beginnormal_vertex, normal_patch);
        }
        return patched_shader;
    };

    var visibility_patch = `
    varying float visible;
    varying vec4 contourist_color;

    void main() {
        if (visible<0.5) {
            discard;
        }`;
    var patch_fragment_shader = function(source_shader, colors) {
        if (!source_shader.includes(shader_program_start)) {
            throw new Error("Cannot find program start in fragment shader for patching.");
        }
        var patched_shader = source_shader.replace(shader_program_start, visibility_patch);
        // force front facing to always be true
        var fragment_key = "normal_fragment";
        var normal_fragment = THREE.ShaderChunk[fragment_key];
        if (!normal_fragment) {
            fragment_key = "normal_fragment_begin";
            normal_fragment = THREE.ShaderChunk[fragment_key];
        }
        if (!normal_fragment) {
            throw new Error("can't find normal fragment");
        }
        normal_fragment = normal_fragment.replace("gl_FrontFacing", "true");
        var patch_target = "#include <" + fragment_key + ">";
        if (!patched_shader.includes(patch_target)) {
            patched_shader = patched_shader.replace(patch_target, normal_fragment);
        } else {
            patched_shader = patched_shader.replace("gl_FrontFacing", "true");
        }
        if (colors) {
            patched_shader = patched_shader.trim();
            // assuming there is no commented bracket past the end!!!
            var end_index = patched_shader.lastIndexOf("}");
            var before = patched_shader.substring(0, end_index);
            var after = patched_shader.substring(end_index);
            var insertion = "    gl_FragColor *= contourist_color;"
            patched_shader = [before, insertion, after].join("\n");
        }
        return patched_shader;
    };

    var interpolate0code0 = `
    bool interpolate0(in vec3 P1, in float fP1, in vec3 P2, in float fP2, 
        in float f0, in float delta, out vec3 interpolated) {
        interpolated = vec3(0, 0, 0);  // degenerate default
        bool use_delta = (abs(delta) > 1e-10);
        float f1scaled = (fP1 - f0);
        float f2scaled = (fP2 - f0);
        if (use_delta) {
            f1scaled = f1scaled / delta;
            f2scaled = f2scaled / delta;
            if (f1scaled > f2scaled) {
                float fsave = f1scaled;
                f1scaled = f2scaled;
                f2scaled = fsave;
                vec3 Psave = P1;
                P1 = P2;
                P2 = Psave;
            }
            float f1ceil = ceil(f1scaled);
            f1scaled = f1scaled - f1ceil;
            f2scaled = f2scaled - f1ceil;
        }
        if ((f1scaled != f2scaled) && (f1scaled * f2scaled < 0.0)) {
            float ratio = f1scaled / (f1scaled - f2scaled);
            interpolated = (ratio * P2) + ((1.0 - ratio) * P1);
        } else {
            return false;
        }
        return true;
    }
    `

    var interpolate0code = `

    float shift_cutoff(in float fP1, in float fP2, in float delta, in float cutoff) {
        if (abs(delta) < 1e-10) {
            return cutoff;
        }
        float mn = min(fP1, fP2);
        float ishift = ceil((mn - cutoff) / delta);
        return cutoff + ishift * delta;
    }
    bool interpolate0(in vec3 P1, in float fP1, in vec3 P2, in float fP2, 
        in float f0, in float delta, out vec3 interpolated) 
    {
        interpolated = vec3(0, 0, 0);  // degenerate default
        bool use_delta = (abs(delta) > 1e-10);
        float f0_shift = shift_cutoff(fP1, fP2, delta, f0);
        //float f0_shift = f0; // DEBUG
        if ((fP1 != fP2) && (((fP1 - f0_shift) * (fP2 - f0_shift)) <= 0.0)) {
            float ratio = (f0_shift - fP2) / (fP1 - fP2);
            interpolated = (ratio * P1) + ((1.0 - ratio) * P2);
            return true;
        } else {
            return false;
        }
    }
    `;

    var Irregular2D_Declarations = `
    uniform float f0;
    uniform float delta;

    attribute vec3 A;
    attribute vec3 B;
    attribute vec3 C;
    attribute vec3 f;

    attribute float point_index;

    //varying vec3 vColor;
    varying float visible;
    `;

    var Regular2D_Declarations = `
    uniform float f0;
    uniform float delta;
    uniform vec3 u;
    uniform vec3 v;
    uniform vec3 origin;

    attribute vec2 indices;
    // attribute vec3 position
    attribute vec2 ij;
    attribute vec4 fbuffer;

    //varying vec3 vColor;
    varying float visible;
    `;

    var Regular_Special = `
    float i = ij[0];
    float j = ij[1];
    float point_index = indices[0];
    float triangle_index = indices[1];
    vec3 A = origin + i * u + j * v;
    vec3 C = A + u + v;
    vec3 B;
    float ll = fbuffer[0];
    float lr = fbuffer[1];
    float ul = fbuffer[2];
    float ur = fbuffer[3];
    vec3 f;
    if (triangle_index < 0.5) {
        B = A + v;
        f = vec3(ll, lr, ur);
    } else {
        B = A + u;
        f = vec3(ll, ul, ur);
    }
    `;

    var Irregular2D_Core = `
    float fA0 = f[0];
    float fB0 = f[1];
    float fC0 = f[2];

    vec3 p1;
    vec3 p2;
    bool p2set = false;
    bool p1set = interpolate0(A, fA0, B, fB0, f0, delta, p1);
    if (!p1set) {
        p1set = interpolate0(A, fA0, C, fC0, f0, delta, p1);
    } else {
        p2set = interpolate0(A, fA0, C, fC0, f0, delta, p2);
    }
    if (!p2set) {
        p2set = interpolate0(B, fB0, C, fC0, f0, delta, p2);
    }
    vec3 newPosition = position;  // degenerate default

    if (p1set && (point_index < 0.5)) {
        newPosition = p1;
        //vColor = vec3( 1.0, 0.5, 1.0);
    } else if (p2set) {
        newPosition = p2;
        //vColor = vec3( 1.0, 1.0, 0.5);
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4( newPosition, 1.0 );
    visible = 0.0;
    if (p1set && p2set) {
        visible = 2.0;
    }`

    var Irregular2D_Vertex_Shader = [
        Irregular2D_Declarations,
        interpolate0code,
        `void main() {`,
        Irregular2D_Core,
        `}`,
        ].join("\n");

    var Regular2D_Vertex_Shader = [
        Regular2D_Declarations,
        interpolate0code,
        `void main() {`,
        Regular_Special,
        Irregular2D_Core,
        `}`,
        ].join("\n");
            
    var Irregular2D_Fragment_Shader = [`
    uniform vec3 color;
    uniform float opacity;
    varying float visible;

    void main() {
        if (visible<1.0) {
            discard;
        }
        gl_FragColor = vec4( color, opacity );

    }
    `].join("\n");

    // coords: rectangular 2d grid of (x, y, z, f(x,y,z))
    //   for point positions and field values.
    var Irregular2D = function(coords, value, delta, limits) {
        
        var nrows = coords.length;
        var ncols = coords[0].length;
        // validate -- rows and columns must all be full length, vectors can be "null"
        for (var i=0; i<nrows; i++) {
            var row = coords[i];
            if (row.length != ncols) {
                throw new Error("all rows must have the same length.");
            }
            for (var j=0; j<ncols; j++) {
                var vector = row[j];
                // allow null vectors for "skip this".
                if ((vector!=null) && (vector.length != 4)) {
                    throw new Error("all vector elements shoud have (x, y, z, f)");
                }
            }
        }

        var Abuffer = [];
        var Bbuffer = [];
        var Cbuffer = [];
        var fbuffer = [];

        // per instance
        for (var i=0; i<nrows-1; i++) {
            var rowi = coords[i];
            var rowi1 = coords[i+1];
            for (var j=0; j<ncols-1; j++) {
                var ll = rowi[j];
                var lr = rowi[j+1];
                var ul = rowi1[j];
                var ur = rowi1[j+1];
                if ((ll != null) && (lr != null) && (ul != null) && (ur != null)) {
                    //for (var ind=0; ind<2; ind++) {
                        //indices.push(ind);
                    var v1 = ll[3]; var v2 = lr[3]; var v3 = ur[3];
                    if ((!limits) || (inrange(limits, [v1, v2, v3]))) {
                        Abuffer.push(ll[0], ll[1], ll[2]);
                        Bbuffer.push(lr[0], lr[1], lr[2]);
                        Cbuffer.push(ur[0], ur[1], ur[2]);
                        fbuffer.push(v1, v2, v3);
                    }
                        //fbuffer.push(ll[3], lr[3], ur[3])
                    //}
                    //for (var ind=0; ind<2; ind++) {
                        //indices.push(ind);
                    v2 = ul[3];
                    if ((!limits) || (inrange(limits, [v1, v2, v3]))) {
                        Abuffer.push(ll[0], ll[1], ll[2]);
                        Bbuffer.push(ul[0], ul[1], ul[2]);
                        Cbuffer.push(ur[0], ur[1], ur[2]);
                        fbuffer.push(v1, v2, v3);
                        //fbuffer.push(ll[3], ul[3], ur[3])
                    }
                }
            }
        }

        return Triangular(Abuffer, Bbuffer, Cbuffer, fbuffer, value, delta);
    };

    var Triangular = function(Abuffer, Bbuffer, Cbuffer, fbuffer, value, delta) {

        var uniforms = {
            color: { type: "c", value: new THREE.Color( 0xffffff ) },
            opacity:   { type: "f", value: 1.0 },
            f0:   { type: "f", value: value },
            delta:   { type: "f", value: delta }
        };

        var setValue = function(value) {
            uniforms.f0.value = value;
        }
        var setDelta = function(value) {
            uniforms.delta.value = value;
        }
        var setOpacity = function(value) {
            uniforms.opacity.value = value;
        }

        var shaderMaterial = new THREE.ShaderMaterial( {
            uniforms:       uniforms,
            vertexShader:   Irregular2D_Vertex_Shader,
            fragmentShader: Irregular2D_Fragment_Shader,
            //blending:       THREE.AdditiveBlending,
            //depthTest:      false,
            transparent:    true
        });

        var buffergeometry = new THREE.InstancedBufferGeometry();
        buffergeometry.boundingSphere = estimate_bounding_sphere(Abuffer);

        var indices = [0, 1];

        var mn = extremum(Abuffer, Math.min);
        var mx = extremum(Bbuffer, Math.max);
        var positions = [mn, mn, mn, mx, mx, mx];

        // per mesh
        var point_index = new THREE.Float32BufferAttribute( indices, 1 );
        buffergeometry.addAttribute("point_index", point_index);
        var position_buffer = new THREE.Float32BufferAttribute( positions, 3 );
        buffergeometry.addAttribute("position", position_buffer);

        // per instance
        buffergeometry.addAttribute("A",
            (new THREE.InstancedBufferAttribute( new Float32Array(Abuffer), 3)));
        buffergeometry.addAttribute("B",
            (new THREE.InstancedBufferAttribute( new Float32Array(Bbuffer), 3)));
        buffergeometry.addAttribute("C",
            (new THREE.InstancedBufferAttribute( new Float32Array(Cbuffer), 3)));
        buffergeometry.addAttribute("f",
            (new THREE.InstancedBufferAttribute( new Float32Array(fbuffer), 3)));

        var object = new THREE.LineSegments( buffergeometry, shaderMaterial );

        var result = {
            // encapsulated interface
            object: object,
            geometry: buffergeometry,
            material: shaderMaterial,
            uniforms: uniforms,
            setValue: setValue,
            setDelta: setDelta,
            setOpacity: setOpacity
        };
        return result;
    };
    
    // coords: rectangular 3d grid of (x, y, z, f(x,y,z))
    //   for point positions and field values.
    var Irregular3D = function(coords, value, material, limits, delta) {
        
        var nrows = coords.length;
        var ncols = coords[0].length;
        var ndepth = coords[0][0].length;
        // validate
        for (var i=0; i<nrows; i++) {
            var row = coords[i];
            if (row.length != ncols) {
                throw new Error("all rows must have the same length.");
            }
            for (var j=0; j<ncols; j++) {
                var depth = row[j];
                if (depth.length != ndepth) {
                    throw new Error("all depth lengths should be the same");
                }
                for (var k=0; k<ndepth; k++) {
                    // allow vector elements to be null for "skip this one".
                    var vector = depth[k];
                    if ((vector != null) && (vector.length != 4)) {
                        throw new Error("all vector elements shoud have (x, y, z, f)");
                    }
                }
            }
        }

        var Abuffer = [];
        var Bbuffer = [];
        var Cbuffer = [];
        var Dbuffer = [];
        var fbuffer = [];

        var Boffsets = [[0, 0, 1], [0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], [1, 0, 0]]
        var Coffsets = [[0, 1, 1], [0, 1, 1], [1, 0, 1], [1, 0, 1], [1, 1, 0], [1, 1, 0]]
        // per instance
        for (var i=0; i<nrows-1; i++) {
            for (var j=0; j<ncols-1; j++) {
                for (var k=0; k<ndepth-1; k++){
                    for (var tetra=0; tetra<6; tetra++) {
                        var Bo = Boffsets[tetra];
                        var Co = Coffsets[tetra];
                        //for (var triangle=0; triangle<2; triangle++) {
                            //for (var ind=0; ind<3; ind++) {
                                // XXX need to do 6 tetrahedra...
                                var Av = coords[i][j][k];
                                var Bv = coords[i+Bo[0]][j+Bo[1]][k+Bo[2]];
                                var Cv = coords[i+Co[0]][j+Co[1]][k+Co[2]];
                                var Dv = coords[i+1][j+1][k+1];
                                //point_indices.push(ind);
                                //triangles.push(triangle);
                                //positions.push(Av[0], Av[1], Av[2]);
                                if ((Av != null) && (Bv != null) && (Cv != null) && (Dv != null)) {
                                    var v1 = Av[3]; var v2 = Bv[3]; var v3 = Cv[3]; var v4 = Dv[3];
                                    if ((!limits) || (inrange(limits, [v1, v2, v3, v4]))) {
                                        Abuffer.push(Av[0], Av[1], Av[2]);
                                        Bbuffer.push(Bv[0], Bv[1], Bv[2]);
                                        Cbuffer.push(Cv[0], Cv[1], Cv[2]);
                                        Dbuffer.push(Dv[0], Dv[1], Dv[2]);
                                        fbuffer.push(v1, v2, v3, v4);
                                        //fbuffer.push(Av[3], Bv[3], Cv[3], Dv[3]);
                                    }
                                }
                            //}
                        //}
                    }
                }
            }
        }

        return Tetrahedral(value, Abuffer, Bbuffer, Cbuffer, Dbuffer, fbuffer, material, delta);
    }

    // Tetrahedral vertices with function values at each vertex.
    var Tetrahedral = function(value, Abuffer, Bbuffer, Cbuffer, Dbuffer, fbuffer, material, delta) {

        if (!material) {
            material = new THREE.MeshNormalMaterial();
        }
        material.side = THREE.DoubleSide;
        var materialShader;
        var uniforms;
        var vertexShader;
        var fragmentShader;
        var result = {};

        if (!delta) {
            delta = 0.0;
        }

        material.onBeforeCompile = function ( shader ) {            
            uniforms = shader.uniforms;
            uniforms["f0"] = { type: "f", value: value };
            uniforms["delta"] = { type: "f", value: delta };
            vertexShader = shader.vertexShader;
            vertexShader = patch_vertex_shader(vertexShader, Irregular3D_Declarations, Irregular3D_Core);
            fragmentShader = shader.fragmentShader;
            fragmentShader = patch_fragment_shader(fragmentShader);
            shader.vertexShader = vertexShader;
            shader.fragmentShader = fragmentShader;
            materialShader = shader;
            result.shader = shader;
            result.vertexShader = vertexShader;
            result.fragmentShader = fragmentShader;
            result.uniforms = uniforms;
        }

        var setValue = function(value) {
            // silently fail if shader is not initialized
            if (uniforms) {
                uniforms.f0.value = value;
            }
        };

        var buffergeometry = new THREE.InstancedBufferGeometry();

        // estimate bounding sphere from Abuffer
        buffergeometry.boundingSphere = estimate_bounding_sphere(Abuffer);

        var point_indices = [];
        var triangles = [];
        var positions = [];

        // per mesh
        for (var triangle=0; triangle<2; triangle++) {
            for (var ind=0; ind<3; ind++) {
                point_indices.push(ind);
                triangles.push(triangle);
                positions.push(Abuffer[0], Abuffer[1], Abuffer[2]);  // dummy values
            }
        }
        // per instance
        buffergeometry.addAttribute("A",
            (new THREE.InstancedBufferAttribute( new Float32Array(Abuffer), 3)));
        buffergeometry.addAttribute("B",
            (new THREE.InstancedBufferAttribute( new Float32Array(Bbuffer), 3)));
        buffergeometry.addAttribute("C",
            (new THREE.InstancedBufferAttribute( new Float32Array(Cbuffer), 3)));
        buffergeometry.addAttribute("D",
            (new THREE.InstancedBufferAttribute( new Float32Array(Dbuffer), 3)));
        buffergeometry.addAttribute("fABCD",
            (new THREE.InstancedBufferAttribute( new Float32Array(fbuffer), 4)));
        
        // per mesh
        var triangle_index = new THREE.Float32BufferAttribute( triangles, 1 );
        buffergeometry.addAttribute("triangle", triangle_index);
        var point_index = new THREE.Float32BufferAttribute( point_indices, 1 );
        buffergeometry.addAttribute("point_index", point_index);
        var position_buffer = new THREE.Float32BufferAttribute( positions, 3 );
        buffergeometry.addAttribute("position", position_buffer);

        var object = new THREE.Mesh( buffergeometry, material );

        //var result = {
        // encapsulated interface, and useful debug values :)
        result.object = object;
        result.geometry = buffergeometry,
        result.material = material;
        result.shader = materialShader;
        result.vertexShader = vertexShader;
        result.fragmentShader = fragmentShader;
        result.uniforms = uniforms;
        result.setValue = setValue;
        return result;
    };

    // coords: rectangular grid of f(x,y,z) field values
    //   for point positions on regular grid.
    var Regular2D = function(values, value, delta, origin, u, v, limits) {

        var nrows = values.length;
        var ncols = values[0].length;
        // validate
        for (var i=0; i<nrows; i++) {
            var row = values[i];
            if (row.length != ncols) {
                throw new Error("all rows must have the same length.");
            }
        }
        origin = default_vector3(origin, 0, 0, 0);
        u = default_vector3(u, 1, 0, 0);
        v = default_vector3(v, 0, 1, 0);

        var uniforms = {
            color: { type: "c", value: new THREE.Color( 0xffffff ) },
            opacity:   { type: "f", value: 1.0 },
            f0:   { type: "f", value: value },
            delta:   { type: "f", value: delta },
            u: { type: "v3", value: u },
            v: { type: "v3", value: v },
            origin: { type: "v3", value: origin },
        };

        var setValue = function(value) {
            uniforms.f0.value = value;
        }
        var setDelta = function(value) {
            uniforms.delta.value = value;
        }
        var setOpacity = function(value) {
            uniforms.opacity.value = value;
        }

        var shaderMaterial = new THREE.ShaderMaterial( {
            uniforms:       uniforms,
            vertexShader:   Regular2D_Vertex_Shader,
            fragmentShader: Irregular2D_Fragment_Shader,
            //blending:       THREE.AdditiveBlending,
            //depthTest:      false,
            //transparent:    true
        });

        var buffergeometry = new THREE.InstancedBufferGeometry();
        var origin_a = origin.toArray();
        var u_a = u.toArray();
        var v_a = v.toArray();
        var extrema = [origin_a[0], origin_a[1], origin_a[2]]
        for (var i=0; i<3; i++) {
            var extremei = origin_a[i] + nrows * u_a[i] + ncols * v_a[i];
            extrema.push(extremei);
        }
        buffergeometry.boundingSphere = estimate_bounding_sphere(extrema);
        
        // per mesh
        var indices = [];
        var positions = [];

        // per instance
        var fbuffer = [];
        var ij = []

        for (var i=0; i<nrows-1; i++) {
            var rowi = values[i];
            var rowi1 = values[i+1];
            for (var j=0; j<ncols-1; j++) {
                var ll = rowi[j];
                var lr = rowi[j+1];
                var ul = rowi1[j];
                var ur = rowi1[j+1];
                if ((!limits) || (inrange(limits, [ll, lr, ul, ur]))) {
                    fbuffer.push(ll, lr, ul, ur);
                    ij.push(i, j);
                }
            }
        }
        var e0 = origin.x + u.x + v.x;
        var e1 = origin.y + u.y + v.y;
        var e2 = origin.z + u.z + v.z;
        for (var triangle=0; triangle<2; triangle++) {
            for (var ind=0; ind<2; ind++) {
                indices.push(ind, triangle);
                positions.push(e0, e1, e2); // dummy value
            }
        }
        positions[0] = origin.x;
        positions[1] = origin.y;
        positions[2] = origin.z;

        // add per mesh attributes
        var indices_b = new THREE.Float32BufferAttribute( indices, 2 );
        buffergeometry.addAttribute("indices", indices_b);
        var position_b = new THREE.Float32BufferAttribute( positions, 3 );
        buffergeometry.addAttribute("position", position_b);
        // add per instance attribute
        var ij_b = new THREE.InstancedBufferAttribute(new Float32Array(ij), 2 );
        buffergeometry.addAttribute("ij", ij_b);
        var fbuffer_b = new THREE.InstancedBufferAttribute(new Float32Array(fbuffer), 4 );
        buffergeometry.addAttribute("fbuffer", fbuffer_b);

        var object = new THREE.LineSegments( buffergeometry, shaderMaterial );

        var result = {
            // encapsulated interface
            object: object,
            geometry: buffergeometry,
            material: shaderMaterial,
            uniforms: uniforms,
            setValue: setValue,
            setDelta: setDelta,
            setOpacity: setOpacity
        };
        return result;
    };

    var Regular3D = function(values, value, origin, u, v, w, material, limits, intensities) {
        var nrows = values.length;
        var ncols = values[0].length;
        var ndepth = values[0][0].length;
        // validate
        for (var i=0; i<nrows; i++) {
            var row = values[i];
            if (row.length != ncols) {
                throw new Error("all rows must have the same length.");
            }
            for (var j=0; j<ncols; j++) {
                var depth = row[j];
                if (depth.length != ndepth) {
                    throw new Error("all depths must have the same length.");
                }
            }
        }
        // xxx intensities should have same shape sd as values if present.
        origin = default_vector3(origin, 0, 0, 0);
        u = default_vector3(u, 1, 0, 0);
        v = default_vector3(v, 0, 1, 0);
        w = default_vector3(w, 0, 0, 1);
        debugger;
        if (!material) {
            material = new THREE.MeshNormalMaterial();
        }
        material.side = THREE.DoubleSide;
        var materialShader;
        var uniforms;
        var vertexShader;
        var fragmentShader;
        var result = {};

        material.onBeforeCompile = function ( shader ) {            
            uniforms = shader.uniforms;
            uniforms["f0"] = { type: "f", value: value };
            uniforms["origin"] = { type: "v3", value: origin };
            uniforms["u_dir"] = { type: "v3", value: u };
            uniforms["v_dir"] = { type: "v3", value: v };
            uniforms["w_dir"] = { type: "v3", value: w };
            vertexShader = shader.vertexShader;
            vertexShader = patch_vertex_shader(vertexShader, Regular3D_Declarations, Regular3D_Core, intensities);
            fragmentShader = shader.fragmentShader;
            fragmentShader = patch_fragment_shader(fragmentShader, intensities);
            shader.vertexShader = vertexShader;
            shader.fragmentShader = fragmentShader;
            materialShader = shader;
            result.shader = shader;
            result.vertexShader = vertexShader;
            result.fragmentShader = fragmentShader;
            result.uniforms = uniforms;
        }

        var setValue = function(value) {
            // silently fail if shader is not initialized
            if (uniforms) {
                uniforms.f0.value = value;
            }
        };

        var buffergeometry = new THREE.InstancedBufferGeometry();
        var origin_a = origin.toArray();
        var u_a = u.toArray();
        var v_a = v.toArray();
        var w_a = w.toArray();
        var extrema = [origin_a[0], origin_a[1], origin_a[2]]
        for (var i=0; i<3; i++) {
            var extremei = origin_a[i] + nrows * u_a[i] + ncols * v_a[i] + ndepth * w_a[i];
            extrema.push(extremei);
        }
        buffergeometry.boundingSphere = estimate_bounding_sphere(extrema);

        // per instance
        var ijk = [];
        // origin, origin+v, origin+u, origin+u+v, ...
        var fbuffer_w0 = [];
        // origin+w, origin+v+w, origin+u+w, origin+u+v+w, ...
        var fbuffer_w1 = [];
        // intensities, only if defined.
        var intensity_buffer = []

        for (var i=0; i<nrows-1; i++) {
            for (var j=0; j<ncols-1; j++) {
                for (var k=0; k<ndepth-1; k++) {
                    var uvw = [];
                    for (var uu=0; uu<2; uu++) {
                        for (var vv=0; vv<2; vv++) {
                            uvw.push(values[i+uu][j+vv][k]);
                            uvw.push(values[i+uu][j+vv][k+1]);
                        }
                    }
                    if ((!limits) || (inrange(limits, uvw))) {
                        fbuffer_w0.push(uvw[0], uvw[2], uvw[4], uvw[6]);
                        fbuffer_w1.push(uvw[1], uvw[3], uvw[5], uvw[7]);
                        ijk.push(i, j, k);
                        if (intensities) {
                            intensity_buffer.push(intensities[i][j][k]);
                        }
                    }
                }
            }
        }

        var ijk_b = new THREE.InstancedBufferAttribute(new Float32Array(ijk), 3 );
        buffergeometry.addAttribute("ijk", ijk_b);
        var w0_b = new THREE.InstancedBufferAttribute(new Float32Array(fbuffer_w0), 4 );
        buffergeometry.addAttribute("fbuffer_w0", w0_b);
        var w1_b = new THREE.InstancedBufferAttribute(new Float32Array(fbuffer_w1), 4 );
        buffergeometry.addAttribute("fbuffer_w1", w1_b);
        if (intensities) {
            var i_b = new THREE.InstancedBufferAttribute(new Float32Array(intensity_buffer), 1 );
            buffergeometry.addAttribute("c_intensity", i_b);
        }

        // per mesh
        var indices = [];
        var positions = [];
        for (var tetra=0; tetra<6; tetra++) {
            for (var triangle=0; triangle<2; triangle++) {
                for (var vertex=0; vertex<3; vertex++) {
                    indices.push(vertex, triangle, tetra);
                    positions.push(origin.x, origin.y, origin.z);
                }
            }
        }
        var indices_b = new THREE.Float32BufferAttribute( indices, 3 );
        buffergeometry.addAttribute("indices", indices_b);
        var position_b = new THREE.Float32BufferAttribute( positions, 3 );
        buffergeometry.addAttribute("position", position_b);

        var object = new THREE.Mesh( buffergeometry, material );
        result.object = object;
        result.geometry = buffergeometry;
        result.material = material;
        result.materialShader = materialShader;
        result.vertexShader = vertexShader;
        result.fragmentShader = fragmentShader;
        result.uniforms = uniforms;
        result.setValue = setValue;
        return result;
    };

    var Slicer = function(
        values, 
        plane_point, 
        plane_normal, 
        origin, u, v, w, 
        material, 
        limits, 
        colors) {
        var nrows = values.length;
        var ncols = values[0].length;
        var ndepth = values[0][0].length;
        // validate
        for (var i=0; i<nrows; i++) {
            var row = values[i];
            if (row.length != ncols) {
                throw new Error("all rows must have the same length.");
            }
            for (var j=0; j<ncols; j++) {
                var depth = row[j];
                if (depth.length != ndepth) {
                    throw new Error("all depths must have the same length.");
                }
            }
        }
        // xxx colors should have similar shape sd as values if present.
        plane_point = default_vector3(plane_point, 1, 1, 1); // ???
        plane_normal = default_vector3(plane_normal, 1, 1, 1);
        origin = default_vector3(origin, 0, 0, 0);
        u = default_vector3(u, 1, 0, 0);
        v = default_vector3(v, 0, 1, 0);
        w = default_vector3(w, 0, 0, 1);
        debugger;
        if (!material) {
            material = new THREE.MeshBasicMaterial();
        }
        material.side = THREE.DoubleSide;
        var materialShader;
        var uniforms;
        var vertexShader;
        var fragmentShader;
        var result = {};

        material.onBeforeCompile = function ( shader ) {            
            uniforms = shader.uniforms;
            uniforms["plane_point"] = { type: "v3", value: plane_point };
            uniforms["plane_normal"] = { type: "v3", value: plane_normal };
            uniforms["origin"] = { type: "v3", value: origin };
            uniforms["u_dir"] = { type: "v3", value: u };
            uniforms["v_dir"] = { type: "v3", value: v };
            uniforms["w_dir"] = { type: "v3", value: w };
            vertexShader = shader.vertexShader;
            vertexShader = patch_vertex_shader(vertexShader, Slicer_Declarations, Slicer_Core, null);
            fragmentShader = shader.fragmentShader;
            fragmentShader = patch_fragment_shader(fragmentShader, colors);
            shader.vertexShader = vertexShader;
            shader.fragmentShader = fragmentShader;
            materialShader = shader;
            result.shader = shader;
            result.vertexShader = vertexShader;
            result.fragmentShader = fragmentShader;
            result.uniforms = uniforms;
        }

        var setPlane = function(px, py, pz, nx, ny, nz) {
            // silently fail if shader is not initialized
            if (uniforms) {
                uniforms.plane_point.value = THREE.Vector3(px, py, pz);
                uniforms.plane_normal.value = THREE.Vector3(nx, ny, nz);
            }
        };

        // per instance
        var ijk = [];
        // intensities, only if defined.
        var colors_buffer = []

        for (var i=0; i<nrows-1; i++) {
            for (var j=0; j<ncols-1; j++) {
                for (var k=0; k<ndepth-1; k++) {
                    var uvw = [];
                    for (var uu=0; uu<2; uu++) {
                        for (var vv=0; vv<2; vv++) {
                            uvw.push(values[i+uu][j+vv][k]);
                            uvw.push(values[i+uu][j+vv][k+1]);
                        }
                    }
                    if ((!limits) || (inrange(limits, uvw))) {
                        ijk.push(i, j, k);
                        if (colors) {
                            var c = colors[i][j][k];
                            colors_buffer.push(c[0], c[1], c[2]);
                        } else {
                            var intensity = values[i][j][k];
                            colors_buffer.push(intensity, intensity, intensity);
                        }
                    }
                }
            }
        }

        var buffergeometry = new THREE.InstancedBufferGeometry();        
        var ijk_b = new THREE.InstancedBufferAttribute(new Float32Array(ijk), 3 );
        buffergeometry.addAttribute("ijk", ijk_b);
        var colors_b = new THREE.InstancedBufferAttribute(new Float32Array(colors_buffer), 3 );
        buffergeometry.addAttribute("c_color", colors_b);

        // per mesh
        var indices = [];
        var positions = [];
        for (var tetra=0; tetra<6; tetra++) {
            for (var triangle=0; triangle<2; triangle++) {
                for (var vertex=0; vertex<3; vertex++) {
                    indices.push(vertex, triangle, tetra);
                    positions.push(origin.x, origin.y, origin.z);
                }
            }
        }
        var indices_b = new THREE.Float32BufferAttribute( indices, 3 );
        buffergeometry.addAttribute("indices", indices_b);
        var position_b = new THREE.Float32BufferAttribute( positions, 3 );
        buffergeometry.addAttribute("position", position_b);

        var object = new THREE.Mesh( buffergeometry, material );
        result.object = object;
        result.geometry = buffergeometry;
        result.material = material;
        result.materialShader = materialShader;
        result.vertexShader = vertexShader;
        result.fragmentShader = fragmentShader;
        result.uniforms = uniforms;
        result.setPlane = setPlane;
        return result;
    };

    // Exported functionality:
    var contourist = {
        Tetrahedral: Tetrahedral,
        Irregular3D: Irregular3D,
        Triangular: Triangular,
        Irregular2D: Irregular2D,
        Regular2D: Regular2D,
        Regular3D: Regular3D,
        Slicer: Slicer
    };

    if( typeof exports !== 'undefined' ) {
        // Use exports if available
        if( typeof module !== 'undefined' && module.exports ) {
            exports = module.exports = { contourist: contourist };
        }
        exports.contourist = contourist;
    }
    else {
        // Attach exports to THREE
        THREE.contourist = contourist;
    }

}).call(this);
