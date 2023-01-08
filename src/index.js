import initializeRoamJSSidebarFeatures from "./sidebar";

export default {
    onload: ({ extensionAPI }) => {
        const unloadRoamJSSidebarFeatures = initializeRoamJSSidebarFeatures(extensionAPI);
        return () => {
            unloadRoamJSSidebarFeatures();
        }
    }
}