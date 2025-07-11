import { UPDATE_INTERVAL, TWO_PI, MAP, IMAGE_CONFIGS } from './constants.js';
import { KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_W, KEY_S, KEY_A, KEY_D } from './constants.js';
import { Player, RayHit, RayState, Sprite } from './constants.js';


export class Raycaster {

    static get MINIMAP_SCALE() {
        return 8
    }

    async loadImages() {
        this.texturesLoaded = false;

        const loadImageToImageData = (src) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0);
                    resolve(ctx.getImageData(0, 0, img.width, img.height));
                };
                img.onerror = () => reject(new Error("Failed to load " + src));
                img.src = src;
            });
        };

        const results = await Promise.all(IMAGE_CONFIGS.map(c =>
            loadImageToImageData(c.src).then(data => ({ id: c.id, data }))
        ));

        for (const r of results) {
            this[r.id] = r.data;
        }

        this.texturesLoaded = true;
    }

    initSprites() {
        const tileSizeHalf = Math.floor(this.tileSize / 2);
        let spritePositions = [];

        const shuffle = (array) => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        const placeEntities = () => {
            const emptyPositions = [];
            const edgePositions = [];

            for (let y = 0; y < this.mapHeight; y++) {
                for (let x = 0; x < this.mapWidth; x++) {
                    if (this.map[y][x] === 0) {
                        const pos = [x * this.tileSize + tileSizeHalf, y * this.tileSize + tileSizeHalf];
                        emptyPositions.push(pos);
                        if (y === 1 || y === this.mapHeight - 2 || x === 1 || x === this.mapWidth - 2) {
                            edgePositions.push(pos);
                        }
                    }
                }
            }

            shuffle(emptyPositions);
            shuffle(edgePositions);

            const usedZombies = [];

            // Place zombies
            for (let i = 0; i < Math.min(15, emptyPositions.length); i++) {
                const pos = emptyPositions[i];
                usedZombies.push(pos);
                spritePositions.push(pos);
            }

            // Helper to check if any zombie is too close
            const isTooClose = (pos) => {
                return usedZombies.some(z => {
                    const dx = Math.abs(z[0] - pos[0]);
                    const dy = Math.abs(z[1] - pos[1]);
                    return dx <= this.tileSize * 2 && dy <= this.tileSize * 2;
                });
            };

            // Place treasure at edge with no zombies within 2 tiles
            for (let pos of edgePositions) {
                if (!isTooClose(pos)) {
                    spritePositions.push(pos);
                    break;
                }
            }
        };

        placeEntities();
        this.sprites = [];

        spritePositions.forEach((pos, index) => {
            const isTreasure = index === spritePositions.length - 1;
            const sprite = new Sprite(
                pos[0],
                pos[1],
                0,
                this.tileSize,
                this.tileSize,
                isTreasure ? "goldImageData" : "spriteImageData"
            );
            console.log(JSON.stringify(sprite));
            this.sprites.push(sprite);
        });
    }



    resetSpriteHits() {
        for (let sprite of this.sprites) {
            sprite.screenPosition = null
        }
    }

    findSpritesInCell(cellX, cellY) {
        let spritesFound = []
        for (let sprite of this.sprites) {
            let spriteCellX = Math.floor(sprite.x / this.tileSize)
            let spriteCellY = Math.floor(sprite.y / this.tileSize)
            if (cellX == spriteCellX && cellY == spriteCellY) {
                spritesFound.push(sprite);
            }
        }
        return spritesFound
    }

    constructor(mainCanvas, displayWidth = window.innerWidth, displayHeight = window.innerHeight, tileSize = 1280, textureSize = 128, fovDegrees = 70) {

        this.map = MAP
        this.stripWidth = 1 // leave this at 1 for now
        this.ceilingHeight = 1 // ceiling height in blocks
        this.mainCanvas = mainCanvas
        this.mapWidth = this.map[0].length
        this.mapHeight = this.map.length
        this.displayWidth = displayWidth
        this.displayHeight = displayHeight
        this.rayCount = Math.ceil(displayWidth / this.stripWidth)
        this.tileSize = tileSize
        this.worldWidth = this.mapWidth * this.tileSize
        this.worldHeight = this.mapHeight * this.tileSize
        this.textureSize = textureSize
        this.fovRadians = fovDegrees * Math.PI / 180
        this.viewDist = (this.displayWidth / 2) / Math.tan((this.fovRadians / 2))
        this.rayAngles = null
        this.viewDistances = null
        this.backBuffer = null

        this.mainCanvasContext;
        this.screenImageData;
        this.textureIndex = 0
        this.textureImageDatas = []
        this.texturesLoadedCount = 0
        this.texturesLoaded = false
        this.gameOver = false;
        this.gameStarted = false;
        this.player = new Player(this.tileSize)
        this.initSprites()
        this.bindKeys()
        this.initMouseControls();
        this.initScreen()
        this.drawMiniMap()
        this.createRayAngles()
        this.createViewDistances()
        this.past = Date.now()

        this.loadImages()
    }

    /**
     * https://stackoverflow.com/a/35690009/1645045
     */
    static setPixel(imageData, x, y, r, g, b, a) {
        let index = (x + y * imageData.width) * 4;
        imageData.data[index + 0] = r;
        imageData.data[index + 1] = g;
        imageData.data[index + 2] = b;
        imageData.data[index + 3] = a;
    }

    static getPixel(imageData, x, y) {
        let index = (x + y * imageData.width) * 4;
        return {
            r: imageData.data[index + 0],
            g: imageData.data[index + 1],
            b: imageData.data[index + 2],
            a: imageData.data[index + 3]
        };
    }

    initScreen() {
        this.mainCanvasContext = this.mainCanvas.getContext('2d');
        let screen = document.getElementById("screen");
        screen.style.width = "100vw";
        screen.style.height = "100vh";
        this.mainCanvas.width = this.displayWidth;
        this.mainCanvas.height = this.displayHeight;
    }

    // Bind the keys to the keysDown array
    bindKeys() {
        this.keysDown = {};
        document.onkeydown = (e) => {
            this.keysDown[e.key] = true;
        }
        document.onkeyup = (e) => {
            this.keysDown[e.key] = false;
        }
    }
    initMouseControls() {
        const canvas = document.getElementById('mainCanvas');

        // Activate pointer lock on click
        canvas.onclick = () => canvas.requestPointerLock();

        document.addEventListener('mousemove', (e) => {
            const sensitivity = 0.003;
            if (document.pointerLockElement === canvas) {
                this.player.rot -= e.movementX * sensitivity;
                this.player.rot %= TWO_PI;
                if (this.player.rot < 0) this.player.rot += TWO_PI;
            }
        });
    }
    gameCycle() {
        if (this.texturesLoaded) {
            const now = Date.now()
            let timeElapsed = now - this.past
            this.past = now
            this.move(timeElapsed);
            this.updateMiniMap();
            let rayHits = [];
            this.resetSpriteHits()
            this.castRays(rayHits);
            this.sortRayHits(rayHits)
            this.drawWorld(rayHits);
            if (!this.gameStarted) {
                setTimeout(() => {
                    alert("Avoid zombies and find the treasure");
                    this.gameStarted = true;
                }, 0)
            }
        }
        let this2 = this
        window.requestAnimationFrame(function () {
            if (!this2.gameOver) {
                this2.gameCycle()
            }
        });
    }

    stripScreenHeight(screenDistance, correctDistance, heightInGame) {
        return Math.round(screenDistance / correctDistance * heightInGame);
    }

    drawTexturedRect(textureData, texSrcX, texSrcY, texSrcW, texSrcH, screenDstX, screenDstY, screenDstW, screenDstH) {

        // Truncate positions to integer pixels
        texSrcX = Math.trunc(texSrcX);
        texSrcY = Math.trunc(texSrcY);
        screenDstX = Math.trunc(screenDstX);
        screenDstY = Math.trunc(screenDstY);

        // These mark the bottom-right corner of the destination rectangle.
        const screenEndX = Math.trunc(screenDstX + screenDstW);
        const screenEndY = Math.trunc(screenDstY + screenDstH);


        const drawWidth = screenEndX - screenDstX;
        const drawHeight = screenEndY - screenDstY;

        // Skip rendering if dimensions are zero
        if (drawWidth === 0 || drawHeight === 0) return;

        // Texture coordinate interpolation
        let currentScreenX = screenDstX;
        let currentScreenY = screenDstY;
        let currentTexX = texSrcX;
        let currentTexY = texSrcY;



        const texStepX = texSrcW / drawWidth;
        const texStepY = texSrcH / drawHeight;

        // Clamp top edge if above screen
        if (currentScreenY < 0) {
            currentTexY = texSrcY + (0 - currentScreenY) * texStepY;
            currentScreenY = 0;
        }

        // Clamp left edge if off-screen
        if (currentScreenX < 0) {
            currentTexX = texSrcX + (0 - currentScreenX) * texStepX;
            currentScreenX = 0;
        }

        // Iterate over each pixel in destination rectangle
        for (let texY = currentTexY, screenY = currentScreenY; screenY < screenEndY && screenY < this.displayHeight; screenY++, texY += texStepY) {
            for (let texX = currentTexX, screenX = currentScreenX; screenX < screenEndX && screenX < this.displayWidth; screenX++, texX += texStepX) {
                const srcPixelX = Math.trunc(texX);
                const srcPixelY = Math.trunc(texY);

                const pixel = Raycaster.getPixel(textureData, srcPixelX, srcPixelY);
                if (pixel.a) {
                    Raycaster.setPixel(this.backBuffer, screenX, screenY, pixel.r, pixel.g, pixel.b, 255);
                }
            }
        }
    }



    drawWallStrip(rayHit, textureX, textureY, wallScreenHeight) {
        let swidth = 1;
        let sheight = this.textureSize;
        let imgx = rayHit.strip * this.stripWidth;
        let imgy = (this.displayHeight - wallScreenHeight) / 2;
        let imgw = this.stripWidth;
        let imgh = wallScreenHeight;
        this.drawTexturedRect(this.wallsImageData, textureX, textureY, swidth, sheight, imgx, imgy, imgw, imgh);
        for (let level = 1; level < this.ceilingHeight; ++level) {
            this.drawTexturedRect(this.wallsImageData, textureX, textureY, swidth, sheight, imgx, imgy - level * wallScreenHeight, imgw, imgh);
        }
    }

    /**
     * Draws only the vertical part of the sprite corresponding to the current screen strip
    */
    drawSpriteStrip(rayHit) {
        let sprite = rayHit.sprite
        if (!rayHit.sprite.screenPosition) {
            rayHit.sprite.screenPosition = this.spriteScreenPosition(rayHit.sprite)
        }
        let rc = rayHit.sprite.screenPosition
        // sprite first strip is ahead of current strip
        if (rc.x > rayHit.strip) {
            return
        }
        // sprite last strip is before current strip
        if (rc.x + rc.w < rayHit.strip) {
            return
        }
        let diffX = Math.trunc(rayHit.strip - rc.x)
        let dstX = rc.x + diffX // skip left parts of sprite already drawn
        let srcX = Math.trunc(diffX / rc.w * this.textureSize)
        let srcW = 1
        if (srcX >= 0 && srcX < this.textureSize) {
            this.drawTexturedRect(this[rayHit.sprite.type], srcX, 0, srcW, this.textureSize, dstX, rc.y, this.stripWidth, rc.h);
        }
    }


    drawSolidFloor() {
        for (let y = this.displayHeight / 2; y < this.displayHeight; ++y) {
            for (let x = 0; x < this.displayWidth; ++x) {
                Raycaster.setPixel(this.backBuffer, x, y, 55, 180, 55, 255);
            }
        }
    }

    drawSolidCeiling() {
        for (let y = 0; y < this.displayHeight / 2; ++y) {
            for (let x = 0; x < this.displayWidth; ++x) {
                Raycaster.setPixel(this.backBuffer, x, y, 64, 145, 250, 255);
            }
        }
    }

    /*
      Floor Casting Algorithm:
      We want to find the location where the ray hits the floor (F)
      1. Find the distance of F from the player's "feet"
      2. Rotate the distance using the current ray angle to find F
         relative to the player
      3. Translate the F using the player's position to get its
         world coordinates
      4. Map the world coordinates to texture coordinates
  
      Step 1 is the most complicated and the following explains how to
      calculate the floor distance
  
      ===================[ Floor Casting Side View ]=======================
      Refer to the diagram below. To get the floor distance relative to the
      player, we can use similar triangle principle:
         dy = height between current screen y and center y
            = y - (displayHeight/2)
         floorDistance / eyeHeight = currentViewDistance / dy
         floorDistance = eyeHeight * currentViewDistance / dy
  
                                 current
                            <-view distance->
                         -  +----------------E <-eye
                         ^  |              / ^
                   dy--> |  |          /     |
                         |  |      /         |
          ray            v  |  /             |
             \           -  y                |<--eyeHeight
              \         /   |                |
               \    /       |<--view         |
                /           |   plane        |
            /               |                |
        /                   |                v
       F--------------------------------------  Floor bottom
       <----------  floorDistance  ---------->
  
      ======================[ Floor Casting Top View ]=====================
      But we need to know the current view distance.
      The view distance is not constant!
      In the center of the screen the distance is shortest.
      But for other angles it changes and is longer.
  
                                 player center ray
                          F         |
                           \        |
                            \ <-dx->|
                   ----------x------+-- view plane -----
         currentViewDistance  \     |               ^
                       |       \    |               |
                       +----->  \   |        center view distance
                                 \  |               |
                                  \ |               |
                                   \|               v
                                    O--------------------
  
       We can calculate the current view distance using Pythogaras theorem:
         x  = current strip x
         dx = distance of x from center of screen
         dx = abs(screenWidth/2 - x)
         currentViewDistance = sqrt(dx*dx + viewDist*viewDist)
  
       We calculate and save all the view distances in this.viewDistances using
       createViewDistances()
    */
    drawTexturedFloor(rayHits) {
        for (let rayHit of rayHits) {
            const wallScreenHeight = this.stripScreenHeight(this.viewDist, rayHit.correctDistance, this.tileSize);
            const centerY = this.displayHeight / 2;
            const eyeHeight = this.tileSize / 2 + this.player.z;
            const screenX = rayHit.strip * this.stripWidth;
            const currentViewDistance = this.viewDistances[rayHit.strip]
            const cosRayAngle = Math.cos(rayHit.rayAngle)
            const sinRayAngle = Math.sin(rayHit.rayAngle)
            let screenY = Math.max(centerY, Math.floor((this.displayHeight - wallScreenHeight) / 2) + wallScreenHeight)
            for (; screenY < this.displayHeight; screenY++) {
                let dy = screenY - centerY
                let floorDistance = (currentViewDistance * eyeHeight) / dy
                let worldX = this.player.x + floorDistance * cosRayAngle
                let worldY = this.player.y + floorDistance * -sinRayAngle
                if (worldX < 0 || worldY < 0 || worldX >= this.worldWidth || worldY >= this.worldHeight) {
                    continue;
                }
                let textureX = Math.floor(worldX) % this.tileSize;
                let textureY = Math.floor(worldY) % this.tileSize;
                if (this.tileSize != this.textureSize) {
                    textureX = Math.floor(textureX / this.tileSize * this.textureSize)
                    textureY = Math.floor(textureY / this.tileSize * this.textureSize)
                }
                let srcPixel = Raycaster.getPixel(this.floorImageData, textureX, textureY)
                Raycaster.setPixel(this.backBuffer, screenX, screenY, srcPixel.r, srcPixel.g, srcPixel.b, 255)
            }
        }
    }

    drawTexturedCeiling(rayHits) {
        for (let rayHit of rayHits) {
            const wallScreenHeight = this.stripScreenHeight(this.viewDist, rayHit.correctDistance, this.tileSize);
            const centerY = this.displayHeight / 2;
            const eyeHeight = this.tileSize / 2 + this.player.z;
            const screenX = rayHit.strip * this.stripWidth;
            const currentViewDistance = this.viewDistances[rayHit.strip]
            const cosRayAngle = Math.cos(rayHit.rayAngle)
            const sinRayAngle = Math.sin(rayHit.rayAngle)
            const currentCeilingHeight = this.tileSize * this.ceilingHeight
            let screenY = Math.min(centerY - 1, Math.floor((this.displayHeight - wallScreenHeight) / 2) - 1)
            for (; screenY >= 0; screenY--) {
                let dy = centerY - screenY
                let ceilingDistance = (currentViewDistance * (currentCeilingHeight - eyeHeight)) / dy
                let worldX = this.player.x + ceilingDistance * cosRayAngle
                let worldY = this.player.y + ceilingDistance * -sinRayAngle
                if (worldX < 0 || worldY < 0 || worldX >= this.worldWidth || worldY >= this.worldHeight) {
                    continue;
                }
                let textureX = Math.floor(worldX) % this.tileSize;
                let textureY = Math.floor(worldY) % this.tileSize;
                if (this.tileSize != this.textureSize) {
                    textureX = Math.floor(textureX / this.tileSize * this.textureSize)
                    textureY = Math.floor(textureY / this.tileSize * this.textureSize)
                }
                let srcPixel = Raycaster.getPixel(this.ceilingImageData, textureX, textureY)
                Raycaster.setPixel(this.backBuffer, screenX, screenY, srcPixel.r, srcPixel.g, srcPixel.b, 255)
            }
        }
    }

    drawWorld(rayHits) {
        this.ceilingHeight = this.ceilingHeight;
        if (!this.backBuffer) {
            this.backBuffer = this.mainCanvasContext.createImageData(this.displayWidth, this.displayHeight);
        }
        let texturedFloorOn = true
        if (texturedFloorOn) {
            this.drawTexturedFloor(rayHits);
        } else {
            this.drawSolidFloor()
        }
        let texturedCeilingOn = true;
        if (texturedCeilingOn) {
            this.drawTexturedCeiling(rayHits);
        } else {
            this.drawSolidCeiling()
        }
        for (let rayHit of rayHits) {
            if (rayHit.sprite) {
                this.drawSpriteStrip(rayHit)
            }
            else {
                let wallScreenHeight = Math.round(this.viewDist / rayHit.correctDistance * this.tileSize);
                let textureX = (rayHit.horizontal ? this.textureSize : 0) + (rayHit.tileX / this.tileSize * this.textureSize);
                let textureY = this.textureSize * (rayHit.wallType - 1);
                this.drawWallStrip(rayHit, textureX, textureY, wallScreenHeight);
            }
        }
        this.mainCanvasContext.putImageData(this.backBuffer, 0, 0);

    }

    /*
      Calculate and save the ray angles from left to right of screen.
  
            screenX
            <------
            +-----+------+  ^
            \     |     /   |
             \    |    /    |
              \   |   /     | this.viewDist
               \  |  /      |
                \a| /       |
                 \|/        |
                  v         v
  
      tan(a) = screenX / this.viewDist
      a = atan( screenX / this.viewDist )
    */
    createRayAngles() {
        if (!this.rayAngles) {
            this.rayAngles = [];
            for (let i = 0; i < this.rayCount; i++) {
                let screenX = (this.rayCount / 2 - i) * this.stripWidth
                let rayAngle = Math.atan(screenX / this.viewDist)
                this.rayAngles.push(rayAngle)
            }
            console.log("No. of ray angles=" + this.rayAngles.length);
        }
    }

    /**
      Calculate and save the view distances from left to right of screen.
    */
    createViewDistances() {
        if (!this.viewDistances) {
            this.viewDistances = [];
            for (let x = 0; x < this.rayCount; x++) {
                let dx = (this.rayCount / 2 - x) * this.stripWidth
                let currentViewDistance = Math.sqrt(dx * dx + this.viewDist * this.viewDist)
                this.viewDistances.push(currentViewDistance)
            }
            console.log("No. of view distances=" + this.viewDistances.length);
        }
    }

    sortRayHits(rayHits) {
        rayHits.sort(function (a, b) {
            return a.distance > b.distance ? -1 : 1
        });
    }

    castRays(rayHits) {
        for (let i = 0; i < this.rayAngles.length; i++) {
            let rayAngle = this.rayAngles[i];
            this.castSingleRay(rayHits, this.player.rot + rayAngle, i);
        }
    }

    /**
     * Called when a cell in the grid has been hit by the current ray
     *
     * If searching for vertical lines, return true to continue search for next vertical line,
     * or false to stop searching for vertical lines
     *
     * If searching for horizontal lines, return true to continue search for next horizontal line
     * or false to stop searching for horizontal lines
     *
     * @param ray Current RayState
     * @return true to continue searching for next line, false otherwise
     */
    onCellHit(ray) {
        let vx = ray.vx, vy = ray.vy, hx = ray.hx, hy = ray.hy
        let up = ray.up, right = ray.right
        let cellX = ray.cellX, cellY = ray.cellY
        let wallHit = ray.wallHit
        let horizontal = ray.horizontal
        let wallFound = false
        let stripIdx = ray.strip
        let rayAngle = ray.rayAngle
        let rayHits = ray.rayHits

        // Check for sprites in cell
        let spritesFound = this.findSpritesInCell(cellX, cellY)
        for (let sprite of spritesFound) {
            let spriteHit = RayHit.spriteRayHit(sprite, this.player.x - sprite.x, this.player.y - sprite.y, stripIdx, rayAngle)
            if (spriteHit.distance) {
                rayHits.push(spriteHit)
            }
        }

        // Handle cell walls
        if (this.map[cellY][cellX] > 0) {
            let distX = this.player.x - (horizontal ? hx : vx);
            let distY = this.player.y - (horizontal ? hy : vy)
            let squaredDistance = distX * distX + distY * distY;
            if (!wallHit.distance || squaredDistance < wallHit.distance) {
                wallFound = true
                wallHit.distance = squaredDistance;
                wallHit.horizontal = horizontal
                if (horizontal) {
                    wallHit.x = hx
                    wallHit.y = hy
                    wallHit.tileX = hx % this.tileSize;
                    // Facing down, flip image
                    if (!up) {
                        wallHit.tileX = this.tileSize - wallHit.tileX;
                    }
                }
                else {
                    wallHit.x = vx
                    wallHit.y = vy
                    wallHit.tileX = vy % this.tileSize;
                    // Facing left, flip image
                    if (!right) {
                        wallHit.tileX = this.tileSize - wallHit.tileX;
                    }
                }
                wallHit.wallType = this.map[cellY][cellX];
            }
        }
        return wallFound
    }

    /**
     * Called when the current ray has finished casting
     * @param ray The ending RayState
     */
    onRayEnd(ray) {
        let rayAngle = ray.rayAngle
        let rayHits = ray.rayHits
        let stripIdx = ray.strip
        let wallHit = ray.wallHit
        if (wallHit.distance) {
            wallHit.distance = Math.sqrt(wallHit.distance)
            wallHit.correctDistance = wallHit.distance * Math.cos(this.player.rot - rayAngle);
            wallHit.strip = stripIdx;
            wallHit.rayAngle = rayAngle;
            this.drawRay(wallHit.x, wallHit.y);
            rayHits.push(wallHit);
        }
    }

    castSingleRay(rayHits, rayAngle, stripIdx) {
        rayAngle %= TWO_PI;
        if (rayAngle < 0) rayAngle += TWO_PI;

        //   2  |  1
        //  ----+----
        //   3  |  4
        let right = (rayAngle < TWO_PI * 0.25 && rayAngle >= 0) || // Quadrant 1
            (rayAngle > TWO_PI * 0.75); // Quadrant 4
        let up = rayAngle < TWO_PI * 0.5 && rayAngle >= 0; // Quadrant 1 and 2
        let slope = Math.tan(rayAngle); // slope of the ray

        let ray = new RayState(rayAngle, stripIdx)
        ray.rayHits = rayHits
        ray.right = right, ray.up = up;
        ray.wallHit = new RayHit

        // Process current player cell
        ray.cellX = Math.trunc(this.player.x / this.tileSize);
        ray.cellY = Math.trunc(this.player.y / this.tileSize);
        this.onCellHit(ray)

        // closest vertical line
        ray.vx = Math.trunc(this.player.x / this.tileSize) * this.tileSize + (right ? this.tileSize : -1)
        ray.vy = this.player.y + (this.player.x - ray.vx) * slope

        // closest horizontal line
        ray.hy = Math.trunc(this.player.y / this.tileSize) * this.tileSize + (up ? -1 : this.tileSize)
        ray.hx = this.player.x + (this.player.y - ray.hy) / slope

        // vector for next vertical line
        let stepvx = right ? this.tileSize : -this.tileSize
        let stepvy = this.tileSize * slope

        // vector for next horizontal line
        let stephy = up ? -this.tileSize : this.tileSize
        let stephx = this.tileSize / slope

        // tan() returns positive values in Quadrant 1 and Quadrant 4
        // But window coordinates need negative coordinates for Y-axis so we reverse them
        if (right) {
            stepvy = -stepvy
        }

        // tan() returns stepx as positive in quadrant 3 and negative in quadrant 4
        // This is the opposite of horizontal window coordinates so we need to reverse the values when angle is facing down
        if (!up) {
            stephx = -stephx
        }

        // === DDA algorithm ===

        // Vertical lines
        ray.vertical = true
        ray.horizontal = false
        while (ray.vx >= 0 && ray.vx < this.worldWidth && ray.vy >= 0 && ray.vy < this.worldHeight) {
            ray.cellX = Math.trunc(ray.vx / this.tileSize)
            ray.cellY = Math.trunc(ray.vy / this.tileSize)
            if (this.onCellHit(ray)) break

            ray.vx += stepvx
            ray.vy += stepvy
        }

        // === DDA algorithm ===


        // Horizontal lines
        ray.vertical = false
        ray.horizontal = true
        while (ray.hx >= 0 && ray.hx < this.worldWidth && ray.hy >= 0 && ray.hy < this.worldHeight) {
            ray.cellX = Math.trunc(ray.hx / this.tileSize)
            ray.cellY = Math.trunc(ray.hy / this.tileSize)

            if (this.onCellHit(ray)) break

            ray.hx += stephx
            ray.hy += stephy
        }

        this.onRayEnd(ray)
    }

    /**
    Algorithm adapted from this article:
    https://dev.opera.com/articles/3d-games-with-canvas-and-raycasting-part-2/
  
                 S----------+                       ------
                  \         |                          ^
                   \        |                          |
                    \<--x-->|                     centerDistance
     spriteDistance  \------+--view plane -----        |
                      \     |               ^          |
                       \    |               |          |
                        \   |         viewDist         |
                         \sa|               |          |
                          \ |-----+         |          |
                           \| rot |         v          v
                            P-----+---------------------------
  
       S  = the sprite      dx  = S.x - P.x      sa  = spriteAngle
       P  = player          dy  = S.y - P.y      rot = player camera rotation
  
      totalAngle = spriteAngle + rot
      tan(spriteAngle) = x / viewDist
      cos(spriteAngle) = centerDistance / spriteDistance
    */
    spriteScreenPosition(sprite) {
        let rc = { x: 0, y: 0, w: 0, h: 0 }

        // Calculate angle between player and sprite
        // We use atan2() to find the sprite's angle if the player rotation was 0 degrees
        // Then we deduct the player's current rotation from it
        // Note that plus (+) is used to "deduct" instead of minus (-) because it takes
        // into account these facts:
        //   a) dx and dy use world coordinates, while atan2() uses cartesian coordinates.
        //   b) atan2() can return positive or negative angles based on the circle quadrant
        let dx = sprite.x - this.player.x
        let dy = sprite.y - this.player.y
        let totalAngle = Math.atan2(dy, dx)
        let spriteAngle = totalAngle + this.player.rot

        // x distance from center line
        let x = Math.tan(spriteAngle) * this.viewDist;

        let spriteDistance = Math.sqrt(dx * dx + dy * dy)
        let centerDistance = Math.cos(spriteAngle) * spriteDistance;

        // spriteScreenWidth   spriteWorldWidth
        // ----------------- = ----------------
        //      viewDist        centerDistance
        let spriteScreenWidth = this.tileSize * this.viewDist / centerDistance
        let spriteScreenHeight = spriteScreenWidth // assume both width and height are the same

        rc.x = (this.displayWidth / 2) + x // get distance from left of screen
            - (spriteScreenWidth / 2)   // deduct half of sprite width because x is center of sprite
        rc.y = (this.displayHeight - spriteScreenWidth) / 2.0
        rc.w = spriteScreenWidth
        rc.h = spriteScreenHeight

        return rc
    }

    drawRay(rayX, rayY) {
        let miniMapObjects = document.getElementById("minimapobjects");
        let objectCtx = miniMapObjects.getContext("2d");

        rayX = rayX / (this.mapWidth * this.tileSize) * 100;
        rayX = rayX / 100 * Raycaster.MINIMAP_SCALE * this.mapWidth;
        rayY = rayY / (this.mapHeight * this.tileSize) * 100;
        rayY = rayY / 100 * Raycaster.MINIMAP_SCALE * this.mapHeight;

        let playerX = this.player.x / (this.mapWidth * this.tileSize) * 100;
        playerX = playerX / 100 * Raycaster.MINIMAP_SCALE * this.mapWidth;

        let playerY = this.player.y / (this.mapHeight * this.tileSize) * 100;
        playerY = playerY / 100 * Raycaster.MINIMAP_SCALE * this.mapHeight;

        objectCtx.strokeStyle = "rgba(0,100,0,0.3)";
        objectCtx.lineWidth = 0.5;
        objectCtx.beginPath();
        objectCtx.moveTo(playerX, playerY);
        objectCtx.lineTo(
            rayX,
            rayY
        );
        objectCtx.closePath();
        objectCtx.stroke();
    }

    // Check if we are allowed to move to the position or if there is a blocking wall
    isBlocking(x, y) {
        this.isOver();
        // Outer boundaries
        if (y < 0 || y >= this.mapHeight || x < 0 || x >= this.mapWidth) return true;
        // wall collision
        return (this.map[Math.floor(y)][Math.floor(x)] != 0);
    }
    isOver() {
        for (let sprite of this.sprites) {
            if ((sprite.x + this.tileSize / 2 > this.player.x && sprite.x - this.tileSize / 2 < this.player.x) && (sprite.y + this.tileSize / 2 > this.player.y && sprite.y - this.tileSize / 2 < this.player.y)) {
                if (sprite.type == "spriteImageData" && !this.gameOver) {
                    alert("Game Over! You were bit by a zombie!");
                    window.location.reload();
                }
                else {
                    alert("Congrats! You found the treasure");
                    window.location.href = "/"
                }
                this.gameOver = true;
            }
        }
    }

    move(timeElapsed) {
        // === 1. Input Handling ===
        const forward = this.keysDown[KEY_UP] || this.keysDown[KEY_W];
        const backward = this.keysDown[KEY_DOWN] || this.keysDown[KEY_S];
        const strafeLeft = this.keysDown[KEY_LEFT] || this.keysDown[KEY_A];
        const strafeRight = this.keysDown[KEY_RIGHT] || this.keysDown[KEY_D];

        // === 2. Time-scaled movement ===
        const delta = timeElapsed / UPDATE_INTERVAL;
        const moveSpeed = this.player.moveSpeed * delta;

        let moveX = 0;
        let moveY = 0;

        // === 3. Forward/backward movement ===
        if (forward) {
            moveX += Math.cos(this.player.rot) * moveSpeed;
            moveY -= Math.sin(this.player.rot) * moveSpeed;
        }
        else if (backward) {
            moveX -= Math.cos(this.player.rot) * moveSpeed;
            moveY += Math.sin(this.player.rot) * moveSpeed;
        }

        // === 4. Strafing movement ===
        if (strafeLeft) {
            moveX += Math.cos(this.player.rot + Math.PI / 2) * moveSpeed;
            moveY -= Math.sin(this.player.rot + Math.PI / 2) * moveSpeed;
        }
        else if (strafeRight) {
            moveX += Math.cos(this.player.rot - Math.PI / 2) * moveSpeed;
            moveY -= Math.sin(this.player.rot - Math.PI / 2) * moveSpeed;
        }

        // === 5. Calculate next position ===
        const nextX = this.player.x + moveX;
        const nextY = this.player.y + moveY;

        // === 6. Collision check ===
        const cellX = Math.floor(nextX / this.tileSize);
        const cellY = Math.floor(nextY / this.tileSize);

        if (!this.isBlocking(cellX, cellY)) {
            this.player.x = Math.floor(nextX);
            this.player.y = Math.floor(nextY);
        }
    }


    updateMiniMap() {
        let miniMapObjects = document.getElementById("minimapobjects");

        let objectCtx = miniMapObjects.getContext("2d");

        miniMapObjects.width = miniMapObjects.width;

        let playerX = this.player.x / (this.mapWidth * this.tileSize) * 100;
        playerX = playerX / 100 * Raycaster.MINIMAP_SCALE * this.mapWidth;

        let playerY = this.player.y / (this.mapHeight * this.tileSize) * 100;
        playerY = playerY / 100 * Raycaster.MINIMAP_SCALE * this.mapHeight;

        objectCtx.fillStyle = "red";
        objectCtx.fillRect(   // draw a dot at the current player position
            playerX - 2,
            playerY - 2,
            4, 4
        );

        objectCtx.strokeStyle = "red";
        objectCtx.beginPath();
        objectCtx.moveTo(playerX, playerY);
        objectCtx.lineTo(
            (playerX + Math.cos(this.player.rot) * 4 * Raycaster.MINIMAP_SCALE),
            (playerY + -Math.sin(this.player.rot) * 4 * Raycaster.MINIMAP_SCALE)
        );
        objectCtx.closePath();
        objectCtx.stroke();
    }

    drawMiniMap() {
        let miniMap = document.getElementById("minimap");     // the actual map
        let miniMapCtr = document.getElementById("minimapcontainer");   // the container div element
        let miniMapObjects = document.getElementById("minimapobjects"); // the canvas used for drawing the objects on the map (player character, etc)

        miniMap.width = this.mapWidth * Raycaster.MINIMAP_SCALE;  // resize the internal canvas dimensions
        miniMap.height = this.mapHeight * Raycaster.MINIMAP_SCALE;  // of both the map canvas and the object canvas
        miniMapObjects.width = miniMap.width;
        miniMapObjects.height = miniMap.height;

        let w = (this.mapWidth * Raycaster.MINIMAP_SCALE) + "px"  // minimap CSS dimensions
        let h = (this.mapHeight * Raycaster.MINIMAP_SCALE) + "px"
        miniMap.style.width = miniMapObjects.style.width = miniMapCtr.style.width = w;
        miniMap.style.height = miniMapObjects.style.height = miniMapCtr.style.height = h;

        let ctx = miniMap.getContext("2d");
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, miniMap.width, miniMap.height);

        // loop through all blocks on the map
        for (let y = 0; y < this.mapHeight; y++) {
            for (let x = 0; x < this.mapWidth; x++) {
                let wall = this.map[y][x];
                if (wall > 0) { // if there is a wall block at this (x,y) ...
                    ctx.fillStyle = "rgb(76, 76, 76)";
                    ctx.fillRect(       // ... then draw a block on the minimap
                        x * Raycaster.MINIMAP_SCALE,
                        y * Raycaster.MINIMAP_SCALE,
                        Raycaster.MINIMAP_SCALE, Raycaster.MINIMAP_SCALE
                    );
                }
            }
        }

        this.updateMiniMap();
    }
}