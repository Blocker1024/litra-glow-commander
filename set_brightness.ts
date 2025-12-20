import streamDeck, { action, DidReceiveSettingsEvent, JsonObject, JsonValue, KeyDownEvent, SingletonAction, SendToPluginEvent, WillAppearEvent } from "@elgato/streamdeck";
import { flashLight, getLightBySerialNumber, sendLightsToUI } from "../global";
import { getBrightnessInLumen, getMaximumBrightnessInLumenForDevice, setBrightnessPercentage, isOn, turnOn, Device, getMinimumBrightnessInLumenForDevice}from "litra";
import { ActionSettings } from "../settings";


function sleep(seconds: number): Promise<void> { //Delay for brightness ramping
        return new Promise(resolve => setTimeout(resolve, seconds));
    }

async function rampBrightness(light: any, targetPercentage: number, duration: number) {
    const currentBrightness = light['Brightness'];
    const maxBrightness = light['Max'];
    const minBrightness = light["Min"];
    const currentPercentage = Math.round((currentBrightness - minBrightness) / (maxBrightness - minBrightness) * 100);
    const percentage = targetPercentage;
    const deltaBrightness = percentage - currentPercentage; //change in percentage points to determine if increment or decrement is needed
    
    if (deltaBrightness > 0) {
        for (let i = currentPercentage + 1; i <= percentage; i++){
            setBrightnessPercentage(light, i);
            await sleep(duration/deltaBrightness * 1000);
        }
        streamDeck.logger.debug(`Brightness ramped up to ${percentage}%`);
    } else if (deltaBrightness < 0) {
        for (let i = currentPercentage - 1; i >= percentage; i--){
            setBrightnessPercentage(light, i);
            await sleep(duration/deltaBrightness * -1000);
        }
        streamDeck.logger.debug(`Brightness ramped down to ${percentage}%`);
    } else streamDeck.logger.debug(`Brightness is already at ${percentage}%`);
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
        const duration = settings.duration as number ?? 0; //duration in seconds for event default to 0 if not speficied
        if (duration != 0) {
            for (const selectedLight of selectedLights) {
                const light: any= getLightBySerialNumber(selectedLight);
                if(light){
                    if (!isOn(light)) {
                        setBrightnessPercentage(light, 0);
                        turnOn(light);
                    }
                    light['Min'] = getMinimumBrightnessInLumenForDevice(light);
                    light['Max'] = getMaximumBrightnessInLumenForDevice(light); 
                    light['Brightness'] = getBrightnessInLumen(light); 
                    rampBrightness(light, percentage, duration);
                }
                else streamDeck.logger.error("Light not found", selectedLight);
            }
        }
        else {
           for (const selectedLight of selectedLights) {
                const light = getLightBySerialNumber(selectedLight);
                if (light) {
                    setBrightnessPercentage(light, percentage);
                    if (!isOn(light)) {
                        turnOn(light);
                    }
                    const currentBrightness = getBrightnessInLumen(light);
                    const maxBrightness = getMaximumBrightnessInLumenForDevice(light);
                    const currentPercentage = Math.round((currentBrightness / maxBrightness) * 100);
                    const valueInLumen = (maxBrightness / 100) * percentage;
                    streamDeck.logger.debug(`Setting brightness of light ${selectedLight} from ${currentPercentage}% (${currentBrightness}lm) to ${percentage}% (${valueInLumen}lm)`);
                }
                else streamDeck.logger.error("Light not found", selectedLight);
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

/*
Updates by Blocker1024: Brightness Ramp and relevant changes

Added brighteness ramp in style of version 1.0.0.1
Added default values for settings to match intended defaults. Previously null if not set in PI
Updated corresponding UI to match
Modified error correction for missing light for increased readability*/