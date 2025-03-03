/**
 * Implementations of panoptic segmentation mask editor.
 * @copyright CEA-LIST/DIASI/SIALV/LVA (2019)
 * @author CEA-LIST/DIASI/SIALV/LVA <pixano@cea.fr>
 * @license CECILL-C
 */

import { customElement, property} from 'lit-element';
import { Controller } from './controller-base';
import { CreateBrushController,
  CreatePolygonController,
  SelectController,
  EditionAddController,
  EditionRemoveController,
  LockController } from './controller-mask';
import { GraphicMask } from './graphics';
import { MaskVisuMode } from './graphic-mask';
import { Canvas } from './pxn-canvas';
import { unfuseId, convertIndexToDict } from './utils-mask';

/**
 * `<pxn-segmentation>` Basic segmentation editor.
 * Use `<pxn-segmentation>` in your document with its src image.
 * <body>
 *   <pxn-segmentation></pxn-segmentation>
 * @customElement
 *
 */
@customElement('pxn-segmentation' as any)
export class Segmentation extends Canvas {

  @property({type: String})
  public mask: ImageData | null = null;

  @property({type: String})
  public mode: 'select' | 'edit-add' | 'edit-remove' | 'create' = 'select';

  @property({type: String})
  public maskVisuMode : MaskVisuMode = MaskVisuMode.SEMANTIC;

  public opacity: number = 0.60;

  public _selectedId: {
    value: [number, number, number] | null
  } = { value: null };

  public _targetClass: { value: number } = { value: 1 };

  // container of mask
  // never destroyed, only updated
  protected gmask: GraphicMask = new GraphicMask();

  private newMaskLoaded: boolean = false;

  public modes: {
    [key: string]: Controller;
  };

  @property({type: Boolean})
  public showroi : boolean;

  constructor() {
    super();
    this.renderer.labelLayer.addChild(this.gmask);
    this.renderer.labelLayer.alpha = this.opacity;

    this.modes = {
      'create': new CreatePolygonController({...this} as any),
      'create-brush': new CreateBrushController({...this} as any),
      'select': new SelectController({...this} as any),
      'edit-add': new EditionAddController({...this} as any),
      'edit-remove': new EditionRemoveController({...this} as any),
      'lock': new LockController({...this} as any)
    };
    this.showroi = (this.modes.create as CreatePolygonController).showRoi;


    // Empty mask on image load
    this.addEventListener('load', this.onImageChanged.bind(this));

    window.addEventListener('keydown', (evt) => {
      if (evt.key === "Alt") { this.switchMode(); }
    });
  }

  get selectedId() {
    return this._selectedId.value;
  }

  set selectedId(id: [number, number, number] | null) {
    this._selectedId.value = id;
  }

  get targetClass() {
    return this._targetClass.value;
  }

  set targetClass(clsIdx: number) {
    this._targetClass.value = clsIdx;
  }

  // Map of class indices and their color (+ if they are instances or semantic)
  // e.g. <1, [255, 0, 0, isInstance (instance = 1, semantic = 0)]
  get clsMap(): Map<number, [number, number, number, number]> {
    return this.gmask.clsMap;
  }

  // Map of class indices and their color
  // [r, g, b, isInstance]
  // if class is instanciable, isInstance = 1 else 0
  set clsMap(clsMap: Map<number, [number, number, number, number]>) {
    if (clsMap instanceof Map) {
      this.gmask.clsMap = clsMap;
    } else if (typeof clsMap === "object") {
      this.gmask.clsMap = new Map(Object.entries(clsMap).map(([k,n]) => ([Number(k),n]))) as any;
    }
  }

  /**
   * Get base64 encoding of the panoptic segmentation mask
   */
  public getMask() {
    return this.gmask.getBase64();
  }

  /**
   * Set the panoptic segmentation mask from a base64 encoding
   */
  public setMask(buffer: string) {
    this.newMaskLoaded = true;
    this.gmask.setBase64(buffer);
  }

  /**
   * Empy segmentation mask
   */
  public setEmpty() {
    if (this.renderer.imageWidth === 0 || this.renderer.imageHeight === 0) {
      return;
    }
    this.gmask.empty(this.renderer.imageWidth, this.renderer.imageHeight);
    this.selectedId = [-1, -1, -1];
  }

  /**
   * Called on every property change
   * @param changedProperty
   */
  protected updated(changedProperties: any) {
    super.updated(changedProperties);

    if (changedProperties.has('mask') && this.mask && this.mask instanceof ImageData) {
      this.newMaskLoaded = true;
      this.gmask.initialize(this.mask);
      this.selectedId = [-1, -1, -1];
    }
    if (changedProperties.has('mode') && this.mode) {
      const prevMode = changedProperties.get('mode');
      this.setMode(prevMode, this.mode);
    }

    if (changedProperties.has('maskVisuMode') && this.maskVisuMode) {
      this.gmask.maskVisuMode = this.maskVisuMode;
      const curMask  = this.gmask.getValue();
      if (curMask instanceof ImageData) {
        this.gmask.recomputeColor();
      }
    }

    if (changedProperties.has('showroi')) {
      const controller = this.modes.create as CreatePolygonController;
      controller.showRoi = this.showroi;
    }
  }

  /**
   * Handle new mode set:
   * 1. Reset canvas to default "mode-free" (no interaction)
   * 2. Apply interactions of new mode
   * @param mode string
   */
   public setMode(prevMode: string, newMode: string) {
    if (prevMode === newMode) {
      return;
    }
    if (this.modes[prevMode]) {
        // Restore default state
        this.modes[prevMode].deactivate();
    }
    // Set up new mode state
    this.modes[newMode]?.activate();
    this.mode = newMode as any;
    this.dispatchEvent(new CustomEvent('mode', {detail: this.mode}));
  }

  /**
   * Fill selected region with current selectedId
   */
  public fillSelection(newId: [number, number, number]) {
    if (this.selectedId) {
      this.gmask.replaceValue(this.selectedId, newId);
      this.selectedId = newId;
  }
  }

  /**
   * Replace the class of the selected region
   * @param newClass class index to replace the selected region with
   */
  public fillSelectionWithClass(newClass: number) {
    if (this._selectedId.value) {
      const currClass = this._selectedId.value[2];
      let newId: [number, number, number] = [ this._selectedId.value[0],  this._selectedId.value[1], newClass];
      if (this.clsMap.get(newClass)![3] && !this.clsMap.get(currClass)![3]) {
        // new class is instance and was semantic before: new instance idx
        const nextIdx = this.gmask.getNextId();
        newId = [nextIdx[0], nextIdx[1], newId[2]];
      } else if (!this.clsMap.get(newClass)![3]) {
        // remove instance indices if the new class is semantic
        newId = [0, 0, newId[2]];
      }
      this.fillSelection(newId);
    }
  }

  /**
   * Set opacity of the mask layer
   * @param opacity number [0-1]
   */
  public setOpacity(opacity: number){
    this.renderer.labelLayer.alpha = opacity;

  }

  /**
   * Toggle mask opacity from 0 to 1.
   */
  public toggleMask() {
    if (this.renderer.labelLayer.alpha === this.opacity) {
      this.renderer.labelLayer.alpha = 1;
      this.renderer.backgroundSprite.visible = false;
    } else if (this.renderer.labelLayer.alpha === 1) {
      this.renderer.labelLayer.alpha = 0;
      this.renderer.backgroundSprite.visible = true;
    } else {
      this.renderer.backgroundSprite.visible = true;
      this.renderer.labelLayer.alpha = this.opacity;
    }
  }

  /**
   * Remove little blobs
   */
  public filterLittle(numPixels: number = 10) {
    this.gmask.fusedIds.forEach((id) => {
      this.filterId(unfuseId(id), numPixels)
    });
    this.dispatchEvent(new Event('update'));
  }

  /**
     * Remove all blobs of selected id with number of pixels below 'blobMinSize'
     * TODO: multiple ids in a single loop
     * @param targetId the id of the blobs to be found
     * @param blobMinSize
     */
   protected filterId(targetId: [number, number, number], blobMinSize: number){
    const blobs = this.gmask.getBlobs(targetId)
    for (const [,blob] of blobs){
        if (blob.nbPixels < blobMinSize) {
            blob.contours.forEach(contour => {
                const arr = convertIndexToDict(contour.points, this.gmask.canvas.width + 1);
                if (contour.type === 'external') {
                    this.gmask.updateByPolygon(arr, targetId, 'remove')
                }
                else {
                    this.gmask.updateByPolygon(arr, targetId, 'add')
                }
            });
        }
    }
}

  /**
   * Switch interaction mode
   */
  public switchMode() {
    const modes = Object.keys(this.modes);
    const currentIdx = modes.findIndex((m) => m === this.mode);
    this.mode = modes[(currentIdx + 1) % modes.length] as any;
    this.dispatchEvent(new Event("mode"));
  }

  /**
     * Change the controler linked to the mode:
     * @param mode string, the mode whome controler has to be changed
     * @param controller the new controler
     */
   public setController(mode: string, controller: Controller) {
    if (mode === this.mode && this.modes[mode]) {
        // remove active base controller
        this.modes[mode].deactivate();
        this.modes[mode] = controller;
        this.modes[mode].activate();
    } else {
        this.modes[mode] = controller;
    }
    return this;
  }

  /**
   * Called on image change
   */
  protected onImageChanged() {
    if (!this.newMaskLoaded) {
      this.setEmpty();
    }
  }
}
