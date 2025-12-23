import streamDeck, { action, DidReceiveSettingsEvent, JsonObject, JsonValue, KeyDownEvent, SingletonAction, SendToPluginEvent, WillAppearEvent } from "@elgato/streamdeck";
import { flashLight, getLightBySerialNumber, sendLightsToUI } from "../global";
import { getBrightnessInLumen, getMinimumBrightnessInLumenForDevice, getMaximumBrightnessInLumenForDevice, setBrightnessPercentage, isOn, turnOn, setBrightnessInLumen, Device }from "litra";
import { ActionSettings } from "../settings";

//Delay for brightness ramping: time received in milliseconds
function sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

async function rampBrightness(light: Device, targetPercentage: number, duration: number) {
    const minBrightness = getMinimumBrightnessInLumenForDevice(light);
    const maxBrightness = getMaximumBrightnessInLumenForDevice(light);
    const currentBrightness = getBrightnessInLumen(light);
    const targetBrightness = Math.ceil((targetPercentage) / 100 * (maxBrightness - minBrightness) + minBrightness);
    const deltaBrightness = targetBrightness - currentBrightness;
    streamDeck.logger.debug(`Current brightness: ${currentBrightness}lm`);
    /*targetbrightness same as percentageWithinRange function from litra 4.5.1
    deltaBrightness used to determine step count and time per step*/

    //Start ramping loop
    if (deltaBrightness > 0) {
        for (let i = currentBrightness + 1; i <= targetBrightness; i++) {
            setBrightnessInLumen(light, i);
            await sleep(Math.round(duration/deltaBrightness * 1000));
        }
        streamDeck.logger.debug(`Brightness ramped up to ${targetPercentage}%`);
    } else if (deltaBrightness < 0) {
        for (let i = currentBrightness - 1; i >= targetBrightness; i--) {
            setBrightnessInLumen(light, i);
            await sleep(Math.round(duration/deltaBrightness * -1000)); //Intentionally negative to get positive time
        }
        streamDeck.logger.debug(`Brightness ramped down to ${targetPercentage}%`);
    } else streamDeck.logger.debug(`Brightness is already at ${targetPercentage}%`);
    //End ramping loop
}

@action({ UUID: "com.eladavron.litra-glow-commander.set-brightness" })
export class SetBrightness extends SingletonAction {
    currentSettings!: ActionSettings;

    override onWillAppear(ev: WillAppearEvent): void | Promise<void> {
        streamDeck.logger.debug("Set Brightness action will appear", ev);
        const settings = ev.payload.settings;
        this.currentSettings = settings as ActionSettings; //Store settings for diff logic
        ev.action.setTitle(settings.showOnIcon ? `${settings.value ?? 50}%` : "");
    }

    override async onKeyDown(ev: KeyDownEvent): Promise<void> {
        streamDeck.logger.debug("Set Brightness action key down", ev);
        const settings = ev.payload.settings;
        const selectedLights = settings.selectedLights as Array<string>;
        const percentage = settings.value as number ?? 50;
        const duration = settings.duration as number ?? 0;
        if (duration != 0) {
            for (const selectedLight of selectedLights) {
                const light= getLightBySerialNumber(selectedLight);
                if(light) {
                    if (!isOn(light)) {
                        setBrightnessPercentage(light, 1);
                        turnOn(light);
                    }
                    rampBrightness(light, percentage, duration);
                } else streamDeck.logger.error("Light not found", selectedLight);
            }
        }
        else {
           for (const selectedLight of selectedLights) {
                const light = getLightBySerialNumber(selectedLight);
                if (light) {
                    const currentBrightness = getBrightnessInLumen(light);
                    setBrightnessPercentage(light, percentage);
                    if (!isOn(light)) {
                        turnOn(light);
                    }
                    const minBrightness = getMinimumBrightnessInLumenForDevice(light);
                    const maxBrightness = getMaximumBrightnessInLumenForDevice(light);
                    const currentPercentage = Math.round((currentBrightness - minBrightness) / (maxBrightness - minBrightness) * 100);
                    const newBrightness = getBrightnessInLumen(light);
                    streamDeck.logger.debug(`Setting brightness of light ${selectedLight} from ${currentPercentage}% (${currentBrightness}lm) to ${percentage}% (${newBrightness}lm)`);
                } else streamDeck.logger.error("Light not found", selectedLight);
            }
        }
    }
        
    override onSendToPlugin(ev: SendToPluginEvent<JsonValue, ActionSettings>): Promise<void> | void {
        streamDeck.logger.debug("Brightness Up action received message from PI", ev);
        sendLightsToUI(ev);
    }

    override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): Promise<void> | void {
        const prevSelected = (this.currentSettings?.selectedLights ?? []) as Array<string>;
        const newSelected = (ev.payload.settings?.selectedLights ?? []) as Array<string>;
        const diff = newSelected.find(light => !prevSelected.includes(light)) ?? prevSelected.find(light => !newSelected.includes(light));
        if (diff) {
            flashLight(diff, 2);
        }
        const value = (ev.payload.settings?.value ?? 50) as number;
        ev.action.setTitle(ev.payload.settings?.showOnIcon ? `${value}%` : "");
        this.currentSettings = ev.payload.settings as ActionSettings;
    }
}

/*Brightness Ramp and relevant changes based on version 1.0.0.1
Added brighteness ramp with duration setting 0-60 seconds as slider in UI
Ramping in lumens using same calculation as litra package v4.5.1
Added default values for settings to match intended defaults. Previously null if not set in Stream Deck UI
Modified error correction for missing light for increased readability
Added command to power on lights that are off when brightness is set
Switched current brightness calculation to match litra package*/