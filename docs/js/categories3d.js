function embed_categories(
  json_file_path,
  category_colors,
  container_div_id,
  checkbox_div_id,
  max_opacity,
  horizontal_checkboxes,
  on_success_callback
) {
  var callback_info = {};

  var renderer, scene, camera;

  var object, uniforms;
  var category_to_info;
  var minf, maxf, all_categories; //description;
  var orbitControls;
  var clock;

  function on_load(data) {
    all_categories = data;
    //orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    clock = new THREE.Clock();
    callback_info.clock = clock;
    init();
    animate();
  }

  function on_load_failure() {
    alert(
      "Could not load local JSON data.\n" +
        "You may need to run a web server to avoid cross origin restrictions."
    );
  }

  jQuery.getJSON(json_file_path, on_load).fail(on_load_failure);

  function init() {
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

    category_to_info = {};
    callback_info.category_to_info = category_to_info;
    callback_info.scene = scene;

    var category_visibility = function(category, checkbox) {
      checkbox.change(function() {
        var info = category_to_info[category];
        if (this.checked) {
          info.material.opacity = max_opacity;
        } else {
          info.material.opacity = 0;
        }
      });
    };

    var center;

    var checkboxes = $("#" + checkbox_div_id);

    for (var i = 0; i < all_categories.length; i++) {
      var description = all_categories[i];
      center = description.center;
      //debugger;
      let category = description.category;
      var cc = category_colors[category];
      description.r = cc[0];
      description.g = cc[1];
      description.b = cc[2];
      description.opacity = cc[3];
      var cc2 = cc.slice();
      cc2[3] = 1;
      var rgba = "rgba(" + cc2.join(",") + ")";
      var cbdiv;
      if (horizontal_checkboxes) {
        cbdiv = $("<span/>").appendTo(checkboxes);
      } else {
        cbdiv = $("<div/>").appendTo(checkboxes);
      }
      var cb = $('<input type="checkbox"/>').appendTo(cbdiv);
      if (description.opacity) {
        cb.prop("checked", true);
      }
      category_visibility(category, cb);
      var labels = [
        "Connecting tubule precursors",
        "Distal tubule precursors",
        "Macula densa/ Loop of Henle precursors",
        "Loop of Henle precursors 1",
        "Loop of Henle precursors 2",
        "Proximal tubule precursors 1",
        "Proximal tubule precursors 2",
        "Renal corpuscle precursors"
      ];
      var cblabel = $("<span>" + labels[category - 1] + "</span>").appendTo(
        cbdiv
      );
      cbdiv.css("background-color", rgba).width("340px");

      // MeshLambertMaterial
      var hmaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        alphaTest: 0.2
      });

      //var hmaterial = new THREE.MeshLambertMaterial( {
      //	color: 0xffffff,
      //	transparent:true,
      //	opacity: 0.5,
      //	alphaTest: 0.2
      //} );
      hmaterial.opacity = description.opacity * max_opacity;
      hmaterial.color.setRGB(
        description.r / 255.0,
        description.g / 255.0,
        description.b / 255.0
      );

      var Abuffer = description["A"];
      var Bbuffer = description["B"];
      var Cbuffer = description["C"];
      var Dbuffer = description["D"];
      var fbuffer = description["f"];
      var value = 9.8;

      info = THREE.contourist.Tetrahedral(
        value,
        Abuffer,
        Bbuffer,
        Cbuffer,
        Dbuffer,
        fbuffer,
        hmaterial
      );
      info.material.wireframe = true;
      scene.add(info.object);
      description.material = info.material;
      category_to_info[category] = description;
    }

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setClearColor(0x050505);

    var container = document.getElementById(container_div_id);
    var c = $(container);
    var w = c.width();
    var h = c.height();
    renderer.setSize(w, h);
    camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 10000);
    callback_info.camera = camera;
    camera.position.x = 5 * center[0]; //-354.2465689567709;
    camera.position.y = 2 * center[1]; //-172.1297558166637;
    camera.position.z = 12 * center[2]; //-181.10999904026764;
    camera.lookAt(new THREE.Vector3(center[0], center[1], center[2]));
    callback_info.center = center;
    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.userZoom = false;
    orbitControls.userePan = false;

    orbitControls.center.set(center[0], center[1], center[2]);

    container.appendChild(renderer.domElement);

    on_success_callback(callback_info);
  }

  function animate() {
    requestAnimationFrame(animate);

    render();
    //stats.update();
  }

  function render() {
    var time = Date.now() * 0.001;
    var delta = clock.getDelta();
    orbitControls.update(delta);
    renderer.render(scene, camera);
  }
}
