import React, { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import BpmnModeler  from "bpmn-js/lib/Modeler";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";
import "./Modeller.scss";
import Button from "react-bootstrap/Button";

import {
  fetchDiagram,
  getProcessActivities,
  fetchAllBpmProcesses
} from "../../apiManager/services/processServices";

import {
  setProcessActivityData,
  setProcessDiagramLoading,
  setProcessDiagramXML,
  setWorkflowAssociation,
} from "../../actions/processActions";

import { 
  deployBpmnDiagram
} from "../../apiManager/services/bpmServices";

import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";

import { 
  BpmnPropertiesPanelModule, 
  BpmnPropertiesProviderModule,
  CamundaPlatformPropertiesProviderModule
 } from 'bpmn-js-properties-panel';

import CamundaExtensionModule from 'camunda-bpmn-moddle/lib';
import camundaModdleDescriptors from 'camunda-bpmn-moddle/resources/camunda';
import { is } from 'bpmn-js/lib/util/ModelUtil';

import { 
  DEFAULT_DEPLOYMENT_NAME, 
  DEFAULT_PROCESS_ID, 
  SUCCESS_MSG,
  ERROR_MSG
} from "./constants/bpmnModellerConstants";

import { MULTITENANCY_ENABLED } from "../../constants/constants";

import { getRootElement } from "./helpers/helper";

const EditModel = React.memo(
  ({ processKey, processInstanceId, tenant }) => {

    const { t } = useTranslation();

    const dispatch = useDispatch();
    const diagramXML = useSelector((state) => state.process.processDiagramXML);
    const [bpmnModeller, setBpmnModeller] = useState(null);
    const [applyAllTenants, setApplyAllTenants] = useState(false);

    const containerRef = useCallback((node) => {
      if (node !== null) {
        setBpmnModeller(new BpmnModeler ({ 
          container: "#canvas",
          propertiesPanel: {
            parent: '#js-properties-panel'
          },
          additionalModules: [
            BpmnPropertiesPanelModule,
            BpmnPropertiesProviderModule,
            CamundaPlatformPropertiesProviderModule,
            CamundaExtensionModule
          ],
          moddleExtensions: {
            camunda: camundaModdleDescriptors
          }
        }));
      }
    }, []);

    useEffect(() => {
      if (bpmnModeller) {
        bpmnModeller.on("import.done", (event) => {
          const { error } = event;
          if (error) {
            console.log("bpmnViewer error >", error);
          }
        });
      }
      return () => {
        bpmnModeller && bpmnModeller.destroy();
      };
    }, [bpmnModeller]);

    useEffect(() => {
      if (processKey) {
        dispatch(setProcessDiagramLoading(true));
        dispatch(fetchDiagram(processKey, tenant));
      } else {
        dispatch(setProcessDiagramLoading(false));
      }
      return () => {
        dispatch(setProcessDiagramLoading(true));
        dispatch(setProcessDiagramXML(""));
      };
    }, [processKey, tenant, dispatch]);

    useEffect(() => {
      if (processInstanceId) {
        dispatch(getProcessActivities(processInstanceId));
      }
      return () => {
        dispatch(setProcessActivityData(null));
      };
    }, [processInstanceId, dispatch]);

    useEffect(() => {
      if (diagramXML && bpmnModeller) {
        bpmnModeller.importXML(diagramXML)
        .then(({ warnings }) => {
          if (warnings.length) {
            console.log("Warnings", warnings);
          }
        })
        .catch((err) => {
          console.log("error", err);
        });
      }

    }, [diagramXML, bpmnModeller]);

    const handleApplyAllTenants = () => {
      setApplyAllTenants(!applyAllTenants);
    };

    async function exportDiagram() {
      try {
        // Convert diagram to xml
        const { xml } = await bpmnModeller.saveXML();
        // Deploy to Camunda
        deployBPMN(xml);
      } catch (err) {
        console.error(err);
      }
    }

    const createBpmnForm = (xml) => {
      const form = new FormData();

      const names = getDeploymentNames();

      // Deployment Name
      form.append('deployment-name', names.deploymentName);
      // Deployment Source
      form.append('deployment-source', 'Camunda Modeler');
      // Tenant ID
      if (tenant && applyAllTenants) {
        form.append('tenant-id', tenant);
      }
      // Make sure that we do not re-deploy already existing deployment
      form.append('enable-duplicate-filtering', 'true');
      // Create 'bpmn file' using blob which includes the xml of the process 
      const blob = new Blob([ xml ], { type: 'text/bpmn' });
      form.append('upload', blob, (names.processID + ".bpmn"));

      return form;

    };

    const getDeploymentNames = () => {

      // Default names
      let deploymentName = DEFAULT_DEPLOYMENT_NAME;
      let processID = DEFAULT_PROCESS_ID;

      // Get elements from process panel, find the root element which contains the deployment name and process ID
      // Use the names assigned in the bpmn-js-properties-panel, otherwise keep the default names
      const rootElement = getRootElement(bpmnModeller);

      if (rootElement && rootElement.businessObject && is(rootElement, 'bpmn:Process')){
        if (rootElement.businessObject.name){
          deploymentName = rootElement.businessObject.name;
        }
        if (rootElement.businessObject.id){
          processID = rootElement.businessObject.id;
        }
      }
      else{
        if (rootElement && rootElement.businessObject.participants){
          if (rootElement.businessObject.participants[0].processRef.name){
            deploymentName = rootElement.businessObject.participants[0].processRef.name;
          }
          if (rootElement.businessObject.participants[0].processRef.id){
            processID = rootElement.businessObject.participants[0].processRef.id;
          }
        }
      }

      // TODO: Do not deploy workflow if there are input errors on the bpmn-js-properties-panel

      return {
        deploymentName: deploymentName,
        processID: processID
      };

    };

    const deployBPMN = (xml) =>{

      const form = createBpmnForm(xml);

      deployBpmnDiagram(form)
      .then((res) => {
        if (res?.data) {
          toast.success(t(SUCCESS_MSG));
          // Reload the dropdown menu
          updateBpmProcesses();
        } else {
          toast.error(t(ERROR_MSG));
          console.log('error');
        }
      })
      .catch((error) => {
        toast.error(t(ERROR_MSG));
        console.log(error);
      });

    };

    const updateBpmProcesses = () => {
      // Update drop down with all processes
      dispatch(fetchAllBpmProcesses());
      // Show the updated workflow as the current value in the dropdown
      const updatedWorkflow = {
        label: getDeploymentNames().deploymentName,
        value: getDeploymentNames().processID,
      };
      dispatch(setWorkflowAssociation(updatedWorkflow));
    };

    const zoom = () => {
      bpmnModeller.get("zoomScroll").stepZoom(1);
    };

    const zoomOut = () => {
      bpmnModeller.get("zoomScroll").stepZoom(-1);
    };
    const zoomReset = () => {
      bpmnModeller.get("zoomScroll").reset();
    };

    return (
      <>
        <div className="bpmn-main-container">
          <div className="bpmn-viewer-container">
            <div
              id="canvas"
              ref={containerRef}
              className="bpm-modeller-container grab-cursor"
              style={{
                border: "1px solid #000000",
              }}
            ></div>

            <div className="d-flex justify-content-end zoom-container">
              <div className="d-flex flex-column">
                <button
                  className="mb-3 btn-zoom"
                  title="Reset Zoom"
                  onClick={() => zoomReset()}
                >
                  <i className="fa fa-retweet" aria-hidden="true" />
                </button>
                <button className="btn-zoom" title="Zoom In" onClick={() => zoom()}>
                  <i className="fa fa-search-plus" aria-hidden="true" />
                </button>
                <button className="btn-zoom" title="Zoom Out" onClick={() => zoomOut()}>
                  <i className="fa fa-search-minus" aria-hidden="true" />
                </button>
              </div>
            </div>
            
          </div>
          {/*
            Stylesheet for the js-properties-panel has been imported in /public/index.html directory as a CDN.
            TODO: Import styles in this js page
          */}
          <div className="properties-panel-parent" id="js-properties-panel"></div>
        </div>

        <div className="deploy-container">
          {/*
            TODO: Implement multi-tenancy
            {MULTITENANCY_ENABLED ? <label className="deploy-checkbox"><input type="checkbox" id="apply-all-tenant-checkbox"/>  Apply for all tenants</label> : null}
          */}
          {!MULTITENANCY_ENABLED ? <label className="deploy-checkbox"><input type="checkbox" onClick={handleApplyAllTenants}/>  Apply for all tenants</label> : null}

          <Button onClick={exportDiagram}>
            Deploy
          </Button>
          
        </div>

      </>

    );
  });

export default EditModel;