function embed_proteins(
    description_file_path,
    sync_camera,
    center,
    container_div_id,
    slider_div_id,
    proteins_div_id,
) {
    var renderer, scene, camera, info, info_outline, protein_to_path, protein_json, slider_div;

    function on_load(data) {
        protein_to_path = data;
        clock = new THREE.Clock();
        init();
        animate();
    };

    function on_load_failure() {
        alert("Could not load local JSON data.\n" +
                "You may need to run a web server to avoid cross origin restrictions.")
    };

    jQuery.getJSON(description_file_path, on_load).fail(on_load_failure);

    function init() {
        var protein_div = $("#" + proteins_div_id);
        slider_div = $( "#" + slider_div_id)
        var select = $("<select/>").appendTo(protein_div);
        var selected;
        for (var protein in protein_to_path) {
            $('<option value="' + protein + '">' + protein.toUpperCase() + '</option>').appendTo(select);
            selected = protein;
        }
        select.val(selected);
        select.change(function () {
            selected = select.val();
            async_load_protein_name(selected);
        })

        $( function() {
            slider_div.slider({
                //orientation: "vertical",
                range: "min",
                min: -1,
                max: 8,
                value: 5,
                step: 0.1,
                slide: function( event, ui ) {
                    val = parseFloat( ui.value );
                    value = val + 0.05;
                    $( "#amount" ).val( ui.value );
                }
            });
        } );

        scene = new THREE.Scene();
        var light = new THREE.PointLight( 0xffffff );
        light.position.set( 1000, 1000, 1000 );
        scene.add( light );
        var light = new THREE.PointLight( 0xddffff );
        light.position.set( -1000, -1000, 1000 );
        scene.add( light );
        var light = new THREE.PointLight( 0xaaffaa );
        light.position.set( 1000, -1000, -1000);
        scene.add( light );
        var light = new THREE.PointLight( 0x888888 );
        light.position.set( -1000, 1000, -1000 );
        scene.add( light );
        var light = new THREE.AmbientLight( 0x444444 );
        scene.add( light );

        renderer = new THREE.WebGLRenderer( { antialias: true } );
        renderer.setClearColor( 0x050505 );
        var container = document.getElementById( container_div_id );
        var c = $(container);
        var w = c.width();
        var h = c.height();
        renderer.setSize( w, h );

        camera = new THREE.PerspectiveCamera( 30, w/h, 0.1, 10000 );
        camera_sync(camera, sync_camera);

        container.appendChild( renderer.domElement );

        async_load_protein_name(selected);
    }

    function animate() {
        requestAnimationFrame( animate );
        render();
    }

    function render() {        
        if ((info) && (info.uniforms)) {
            info.uniforms.f0.value = value;
        }
        camera_sync(camera, sync_camera);
        renderer.render( scene, camera );
    }

    function async_load_protein_name(protein_name) {
        debugger;
        var json_file_path = protein_to_path[protein_name];
        if (!json_file_path) {
            alert("No such protein " + protein_name);
        }
        json_file_path = json_file_path.replace("../docs/", "./");
        jQuery.getJSON(json_file_path, load_protein_data).fail(on_load_failure);
    }

    // slider center values requested by Rachel
    var slider_val = {
        Pou3f3: 1.6,
        Erbb4: 1.5,
        Sox9: 2,
        Pappa2: 2.6,
        Cdh1: 1.5,
        Six2: 1.8,
        Cdh6: 1.2,
        Foxc2: 1.7,
        Hnf1b: 0.7,
        Sall1: 0.7,
        Emx2: 0.5,
        Lhx1: 1.6,
        Pax2: 0.3,
        Jag1: 1.1,
        Mafb: 2.2,
        Wt1: 1.6,
        Troma1: 1.3,
        Mecom: 0.5,
        Lef1: 1.8,
    };
    for (var protein_name in slider_val) {
        slider_val[protein_name.toLowerCase()] = slider_val[protein_name];
    }

    function load_protein_data(data) {
        protein_json = data;
        var array = data.array;
        var name = data.name;
        if (info) {
            scene.remove(info.object);
            scene.remove(info_outline.object);
        }
        // adjustable wireframe
        var hmaterial = new THREE.MeshLambertMaterial( { 
            color: 0xff0000, 
            transparent:true, 
            opacity: 1.0,
            alphaTest: 0.1
        } );
        value = 0.5;
        var limits = [-10, 100];
        var origin = [0, 0, 0];
        var u = [1, 0, 0];
        var v = [0, 1, 0];
        var w = [0, 0, 1];
        info = THREE.contourist.Regular3D(
            array, value, origin, u, v, w, hmaterial, limits
        );
        info.material.wireframe = true;
        scene.add(info.object);
        // static outline
        var hmaterial_outline = new THREE.MeshLambertMaterial( { 
            color: 0xffffff, 
            transparent:true, 
            opacity: 0.3,
            alphaTest: 0.1
        } );
        var outline_value = -0.994;
        info_outline = THREE.contourist.Regular3D(
            array, outline_value, origin, u, v, w, hmaterial_outline, limits
        );
        scene.add(info_outline.object);
        var protein_val = slider_val[name];
	var protein_max = protein_val + 0.5;
	var protein_min = protein_val - 0.5;
        if (protein_val) {
            slider_div.slider({max: protein_max});
	    slider_div.slider({min: protein_min});
	    slider_div.slider({value: protein_val});
        } else {
            console.warn("no slider val found for " + name)
        }
	//var protein_min = slider_min[name];
        //if (protein_min) {
        //    slider_div.slider({min: protein_min});
        //} else {
	//   console.warn("no slider max found for " + name)
        //}
    }

    function camera_sync(camera, sync_camera) {
        camera.position.x = sync_camera.position.x;
        camera.position.y = sync_camera.position.y;
        camera.position.z = sync_camera.position.z;
        // https://stackoverflow.com/questions/23642912/three-js-get-camera-lookat-vector
        //var lookAtVector = new THREE.Vector3(0,0, -1);
        //lookAtVector.applyQuaternion(camera.quaternion);
        //camera.lookAt(lookAtVector);
        camera.lookAt(new THREE.Vector3(center[0], center[1], center[2]));
    }

}