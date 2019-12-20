
var attach_opacity_selector = function(target, color_mappings, on_change) {
    var element = $("<div/>").appendTo(target);
    var config = {
                width: 500,
                height: 300,
            };
    element.dual_canvas_helper(config);

    var category_to_mapping = {};
    var mapping_sequence = [];
    var ncategories = color_mappings.length;
    
    for (var i=0; i<ncategories; i++) {
        var mapping = $.extend({}, color_mappings[i]);
        mapping.index = i;
        category_to_mapping[mapping.category] = mapping;
        mapping_sequence.push(mapping);
    }
    element.category_to_mapping = category_to_mapping;
    
    var report_change = function () {
        if (on_change) {
            var data = {};
            for (var category in category_to_mapping) {
                var mapping = category_to_mapping[category];
                entry = {};
                entry.category = category;
                entry.r = mapping.r;
                entry.g = mapping.g;
                entry.b = mapping.b;
                entry.opacity = mapping.opacity;
                data[category] = entry;
            }
            on_change(data);
        }
    };
    

    var tracking_index = null;
    var tracking_opacity = null;
    
    var draw_selector = function () {
        element.reset_canvas();
        var opacity_frame = element.frame_region(0, 0, 300, 250, -0.1, ncategories, 1.1, 0, "opacity_frame");
        
        for (var category in category_to_mapping) {
            var mapping = category_to_mapping[category];
            var index = mapping.index;
            var color = "rgb(" + [mapping.r, mapping.g, mapping.b].join(",") + ")";
            var opaque_color = "rgba(" + [mapping.r, mapping.g, mapping.b, mapping.opacity].join(",") + ")";
            opacity_frame.text({
                x:-0.02, y:index+0.8, text: "" + category, align: "right"
            });
            opacity_frame.frame_rect({
                x:0, y:index+0.2, w:1.05, h:0.6, color:"black"
            });
            var triangle = [[0, index+0.5], [1, index+1], [1, index]];
            mapping.triangle = opacity_frame.polygon({
                points: triangle, color: opaque_color, name:true, events:false,
            });
            mapping.slider_interior = opacity_frame.frame_rect({
                x:mapping.opacity, y:index, w:0.05, h:1, color:opaque_color, 
                name:true, events:false
            });
            mapping.slider_outline = opacity_frame.frame_rect({
                x:mapping.opacity, y:index, w:0.05, h:1, color:color, 
                fill:false, name:true, lineWidth:3, events:false,
            });
        }
        // Position a color chooser on the canvas.
        var chosen_color = null;

        element.color_chooser({
            x: 320, y: 20, side:200, font: "normal 7px Arial",
            callback: function(color_array, color_string) { chosen_color = color_array; }
        });
        
        var reset = element.text({
            text: "RESET", name:true, color:"white", background:"red", x:320, y:240
        });
        reset.on("click", function() { draw_selector(); });
        
        // mouse tracker circle (initially hidden)
        var tracker = opacity_frame.circle({
            name:"mouse_track", r:5,
            events: false,  // This object is invisible to events.
            x:0, y:0, color:"black", hide:true});
        
        // invisible event rectangle
        var event_rectangle = opacity_frame.frame_rect({
            name: true, x:-0.1, y:0, w:1.2, h: ncategories, color: "rgba(0,0,0,0.1)"
        });
        
        //var tracking_index = null;
        //var tracking_opacity = null;
        
        var update_opacity = function () {
            if ((tracking_index !== null) && (tracking_opacity !==null)) {
                var mapping = mapping_sequence[tracking_index];
                var opaque_color = "rgba(" + [mapping.r, mapping.g, mapping.b, tracking_opacity].join(",") + ")";
                mapping.slider_interior.change({color: opaque_color, x:tracking_opacity});
                mapping.slider_outline.change({x:tracking_opacity});
                mapping.triangle.change({color: opaque_color});
                mapping.opacity = tracking_opacity;
                report_change();
            }
        };
        
        update_opacity();
        
        var on_mouse_move = function(event) {
            debugger;
            var name = event.canvas_name;
            var location = event['model_location'];
            var index = Math.floor(location.y);
            tracking_opacity = Math.max(Math.min(location.x, 1), 0);
            
            if ((index<0) || (index>ncategories)) {
                console.warn("bad location " + index);
                return;
            }
            var mapping = mapping_sequence[index];
            if ((chosen_color)) {
                var color = "rgb(" + chosen_color.join(",") + ")";
                tracker.change(
                    {hide:false, x:location.x, y:index+0.5, color:color});
                // on click change the color of the named object
                if (event.type == "mouseup") {
                    mapping.r = chosen_color[0];
                    mapping.g = chosen_color[1];
                    mapping.b = chosen_color[2];
                    return draw_selector();
                }
            } else {
                tracker.change({hide: true});
                if (event.type == "mousedown") {
                    var old_tracking_index = tracking_index;
                    tracking_index = index;
                    if (old_tracking_index !== null) {
                        return draw_selector();
                    }
                }
                update_opacity();
                if ((event.type == "mouseup") && (tracking_index !== null)) {
                    var mapping = mapping_sequence[tracking_index];
                    mapping.opacity = tracking_opacity;
                    tracking_index = null;
                    return draw_selector();
                }
            }
        };
        event_rectangle.on("mousemove", on_mouse_move);
        event_rectangle.on("mouseup", on_mouse_move);
        event_rectangle.on("mousedown", on_mouse_move);
        // call back the initial state
        report_change();
    };
    
    draw_selector();
    element.fit();
    element.dialog({height:'auto', width:'auto', position: {
        my: "right center",
        at: "right bottom",
        of: "#container"
      }});
    return element;
}

// var colorizer = attach_opacity_selector(element, categories, update_colors);


