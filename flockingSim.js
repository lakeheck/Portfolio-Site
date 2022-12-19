import * as THREE from 'three';
import Stats from 'stats'; //a small clickable div to display frame rate in the corner 
import { GUI } from 'gui';

import { GPUComputationRenderer } from 'compute';

/* TEXTURE WIDTH FOR SIMULATION */
const WIDTH = 50;

const BIRDS = WIDTH * WIDTH;

// Custom Geometry - using 3 triangles each. No UVs, no normals currently.
class BirdGeometry extends THREE.BufferGeometry {

    constructor() {

        super();

        const trianglesPerBird = 3;
        const triangles = BIRDS * trianglesPerBird;
        const points = triangles * 3;

        const vertices = new THREE.BufferAttribute( new Float32Array( points * 3 ), 3 );
        const birdColors = new THREE.BufferAttribute( new Float32Array( points * 3 ), 3 );
        const references = new THREE.BufferAttribute( new Float32Array( points * 2 ), 2 );
        const birdVertex = new THREE.BufferAttribute( new Float32Array( points ), 1 );

        this.setAttribute( 'position', vertices );
        this.setAttribute( 'birdColor', birdColors );
        this.setAttribute( 'reference', references );
        this.setAttribute( 'birdVertex', birdVertex );

        // this.setAttribute( 'normal', new Float32Array( points * 3 ), 3 );


        let v = 0;

        function verts_push() {

            for ( let i = 0; i < arguments.length; i ++ ) {

                vertices.array[ v ++ ] = arguments[ i ];

            }

        }

        const wingsSpan = 20;

        for ( let f = 0; f < BIRDS; f ++ ) {

            // Body

            verts_push(
                0, - 0, - 20,
                0, 4, - 20,
                0, 0, 30
            );

            // Wings

            verts_push(
                0, 0, - 15,
                - wingsSpan, 0, 0,
                0, 0, 15
            );

            verts_push(
                0, 0, 15,
                wingsSpan, 0, 0,
                0, 0, - 15
            );

        }

        for ( let v = 0; v < triangles * 3; v ++ ) {

            const triangleIndex = ~ ~ ( v / 3 );
            const birdIndex = ~ ~ ( triangleIndex / trianglesPerBird );
            const x = ( birdIndex % WIDTH ) / WIDTH;
            const y = ~ ~ ( birdIndex / WIDTH ) / WIDTH;

            const c = new THREE.Color(
                0x444444 +
                ~ ~ ( v / 9 ) / BIRDS * 0x666666
            );

            birdColors.array[ v * 3 + 0 ] = c.r;
            birdColors.array[ v * 3 + 1 ] = c.g;
            birdColors.array[ v * 3 + 2 ] = c.b;

            references.array[ v * 2 ] = x;
            references.array[ v * 2 + 1 ] = y;
            
            birdVertex.array[ v ] = v % 9;
            
        }
        
        this.scale( 0.2, 0.2, 0.2 );
        
    }
    
}

//

let container, stats;
let camera, scene, renderer;
let mouseX = 10000, mouseY = 10000;

let windowHalfX = window.innerWidth / 2;
let windowHalfY = window.innerHeight / 2;

const BOUNDS = 800, BOUNDS_HALF = BOUNDS / 2;

let last = performance.now();

let gpuCompute;
let velocityVariable;
let positionVariable;
let positionUniforms;
let velocityUniforms;
let birdUniforms;

let targetClock = 0; //agents will lose interest over time 

let video = document.getElementById('video');


if(isMobile()==false){ //if mobile we just want to display the links and a picture
    init();
    animate();
}

function init() {
    video.play();
    container = document.createElement( 'div' );
    document.body.appendChild( container );

    camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 150, 3000 );
    camera.position.z = 350;

    scene = new THREE.Scene();
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.needsUpdate = true;

    scene.background = new THREE.Color( 0xffffff );
    scene.background = videoTexture;
    scene.fog = new THREE.Fog( 0xffffff, 100, 1000 );

    
    renderer = new THREE.WebGLRenderer( );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.appendChild( renderer.domElement );
    // renderer.setClearColor( 0x000000, 0 ); // the default
    initComputeRenderer();

    container.style.touchAction = 'none';
    container.addEventListener( 'pointermove', onPointerMove );
    container.addEventListener( 'click', onClick );
    //

    window.addEventListener( 'resize', onWindowResize );

    // const gui = new GUI();


    const effectController = {
        separation: 20.0,
        alignment: 20.0,
        cohesion: 20.0,
        freedom: 0.75
    };

    const valuesChanger = function () {

        velocityUniforms[ 'separationDistance' ].value = effectController.separation;
        velocityUniforms[ 'alignmentDistance' ].value = effectController.alignment;
        velocityUniforms[ 'cohesionDistance' ].value = effectController.cohesion;
        velocityUniforms[ 'freedomFactor' ].value = effectController.freedom;

    };

    valuesChanger();

    // gui.add( effectController, 'separation', 0.0, 100.0, 1.0 ).onChange( valuesChanger );
    // gui.add( effectController, 'alignment', 0.0, 100, 0.001 ).onChange( valuesChanger );
    // gui.add( effectController, 'cohesion', 0.0, 100, 0.025 ).onChange( valuesChanger );
    // gui.close();

    initBirds();

}

function initComputeRenderer() {

    gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );

    if ( renderer.capabilities.isWebGL2 === false ) {

        gpuCompute.setDataType( THREE.HalfFloatType );

    }

    const dtPosition = gpuCompute.createTexture();
    const dtVelocity = gpuCompute.createTexture();
    fillPositionTexture( dtPosition );
    fillVelocityTexture( dtVelocity );

    velocityVariable = gpuCompute.addVariable( 'textureVelocity', document.getElementById( 'fragmentShaderVelocity' ).textContent, dtVelocity );
    positionVariable = gpuCompute.addVariable( 'texturePosition', document.getElementById( 'fragmentShaderPosition' ).textContent, dtPosition );

    gpuCompute.setVariableDependencies( velocityVariable, [ positionVariable, velocityVariable ] );
    gpuCompute.setVariableDependencies( positionVariable, [ positionVariable, velocityVariable ] );

    positionUniforms = positionVariable.material.uniforms;
    velocityUniforms = velocityVariable.material.uniforms;

    positionUniforms[ 'time' ] = { value: 0.0 };
    positionUniforms[ 'delta' ] = { value: 0.0 };
    velocityUniforms[ 'time' ] = { value: 1.0 };
    velocityUniforms[ 'delta' ] = { value: 0.0 };
    velocityUniforms[ 'testing' ] = { value: 1.0 };
    velocityUniforms[ 'separationDistance' ] = { value: 1.0 };
    velocityUniforms[ 'alignmentDistance' ] = { value: 1.0 };
    velocityUniforms[ 'cohesionDistance' ] = { value: 1.0 };
    velocityUniforms[ 'freedomFactor' ] = { value: 10.0 };
    velocityUniforms[ 'target' ] = { value: new THREE.Vector3() };
    velocityVariable.material.defines.BOUNDS = BOUNDS.toFixed( 2 );

    velocityVariable.wrapS = THREE.RepeatWrapping;
    velocityVariable.wrapT = THREE.RepeatWrapping;
    positionVariable.wrapS = THREE.RepeatWrapping;
    positionVariable.wrapT = THREE.RepeatWrapping;

    const error = gpuCompute.init();

    if ( error !== null ) {

        console.error( error );

    }

}

function initBirds() {

    const geometry = new BirdGeometry();

    // For Vertex and Fragment
    birdUniforms = {
        'color': { value: new THREE.Color( 0xff2200 ) },
        'texturePosition': { value: null },
        'textureVelocity': { value: null },
        'time': { value: 1.0 },
        'delta': { value: 0.0 }
    };

    // THREE.ShaderMaterial
    const material = new THREE.ShaderMaterial( {
        uniforms: birdUniforms,
        vertexShader: document.getElementById( 'birdVS' ).textContent,
        fragmentShader: document.getElementById( 'birdFS' ).textContent,
        side: THREE.DoubleSide

    } );

    const birdMesh = new THREE.Mesh( geometry, material );
    birdMesh.rotation.y = Math.PI / 2;
    birdMesh.matrixAutoUpdate = false;
    birdMesh.updateMatrix();

    scene.add( birdMesh );

}

function fillPositionTexture( texture ) {

    const theArray = texture.image.data;

    for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {

        const x = Math.random() * BOUNDS - BOUNDS_HALF;
        const y = Math.random() * BOUNDS - BOUNDS_HALF;
        const z = Math.random() * BOUNDS - BOUNDS_HALF;

        theArray[ k + 0 ] = x;
        theArray[ k + 1 ] = y;
        theArray[ k + 2 ] = z;
        theArray[ k + 3 ] = 1;

    }

}

function fillVelocityTexture( texture ) {

    const theArray = texture.image.data;

    for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {

        const x = Math.random() - 0.5;
        const y = Math.random() - 0.5;
        const z = Math.random() - 0.5;

        theArray[ k + 0 ] = x * 10;
        theArray[ k + 1 ] = y * 10;
        theArray[ k + 2 ] = z * 10;
        theArray[ k + 3 ] = 1;

    }

}

function onWindowResize() {

    windowHalfX = window.innerWidth / 2;
    windowHalfY = window.innerHeight / 2;

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

}

function onPointerMove( event ) {

    if ( event.isPrimary === false ) return;

    mouseX = event.clientX - windowHalfX;
    mouseY = event.clientY - windowHalfY;
    targetClock = 0; //restart clock
    
}

function onClick( event ) { //reset mouse location
    mouseX = 10000;
    mouseY = 10000;    
}
//

function animate() {

    requestAnimationFrame( animate );
    render();
}

function renderWithoutBirds(){
    renderer.render(scene, camera);
}

function render() {
    
    const now = performance.now();
    
    let delta = ( now - last ) / 1000;
    
    if ( delta > 1 ) delta = 1; // safety cap on large deltas
    last = now;
    
    positionUniforms[ 'time' ].value = now;
    positionUniforms[ 'delta' ].value = delta;
    velocityUniforms[ 'time' ].value = now;
    velocityUniforms[ 'delta' ].value = delta;
    birdUniforms[ 'time' ].value = now;
    birdUniforms[ 'delta' ].value = delta;
    
    velocityUniforms[ 'target' ].value.set( 0.5 * mouseX / windowHalfX, - 0.5 * mouseY / windowHalfY, 0 );
    
    
    if (targetClock > 2){//birds lose interest after 5 seconds
        mouseX = 10000;
        mouseY = 10000;
    }

    targetClock+=delta;

    
    gpuCompute.compute();

    birdUniforms[ 'texturePosition' ].value = gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
    birdUniforms[ 'textureVelocity' ].value = gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
    

    //TODO - package up the scene as a module that can be imported and return a texture of the scene with some easy to configure paraemters 
    //below, for rendering to a scene 
    // renderer.setRenderTarget( renderTarget );
    // renderer.render( scene, camera );
    // renderer.setRenderTarget( null );
    frames = 0;
    renderer.render( scene, camera );
}


function isMobile () {
    let check = false;
    (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||window.opera);
    return check;
  };
