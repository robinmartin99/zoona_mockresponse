/**********************************************************
 *  Robin's mock response generator
 * 
 *  Builds a mock response from a OAS/Swagger JSON file
 *  
 *  @assumes  variable oasdotjs contains the OASdefinition
 *  @returns  {object} mockresponse  
 * 
 * Update: Return swagger response defined if no schema response coded.
 *
 * ********************************************************
*/
var oas = {};

/**
 * Return a copy of the input with $ref values expanded.
 *
 * @param   {object} input  A Swagger schema object
 * @returns {object}        A copy of the input with $ref values expanded
 */
function expanded(input) {
  return expand(Object.assign({}, input));
}


/**
 * Expands a schema in-place (mutates the input).
 *
 * @param   {object} input    A Swagger schema object
 * @param   {object} current  The schema property to expand
 * @param   {object} cache    Map of $ref values
 * @returns {object}          The original input, with $ref values expanded
 */

//== old-school Apigee JS does not support this syntax
//==  function expand(input, current = null, cache = {}) {
function expand(input, current, cache) {
	
	//== initialise variables the old way
	current = current || null;
	cache = cache || {};
	
	
	current = current || input;

	//==  Object.keys(current).forEach(child => {   //== This must also be regressed
	for (var child in current ) {  
   
		if (child === '$ref') {
		  Object.assign(current, getReferenceValue(input, current[child], cache));
		  delete current.$ref;
		}
		else if (typeof current[child] === 'object') {
		  expand(input, current[child], cache);
		}
	}   //== })
	return input;
}

/**
 * Memoized lookup of $ref values by name.
 *
 * @param   {object} input  A Swagger schema object
 * @param   {String} name   The reference name to lookup
 * @param   {object} cache  Map of cached $ref values
 * @returns {object}        The value of the named $ref   
 */
function getReferenceValue(input, name, cache) {
  if (cache.hasOwnProperty(name)) {
    return cache[name];
  } else {
	  
	//== rewrite these lines in old school way  
    //const [ref, ...valuePath] = name.split('/');
	//const value = valuePath.reduce((parent, key) => parent[key], input);

	//== Looking for ... an inline resource, no external URLs supported
	//==  !!ASSUMES: Only 2 levels, i.e. #/definitions/{method}
	const arr = name.split('/');
	const defn = arr[arr.length-2];
	const defkey = arr[arr.length-1];
	const varkey = "input."+defn+"."+defkey;
	const value = eval(varkey);

    cache[name] = value;
    return value;
  }
}

/**
 * Convert the value to a standard value 
 */
function convertSwaggerTypeToExample (type, name) {
  switch (type) {
    case 'integer':
      return 0;
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'string':
      return name || type;
    default:
      return type;
  }
}

//== Return the first response coded (Normally that is a 200 response)
//== Assumes: The "operationId" parameter must be present - and it equals the conditional flow name
function response200orFirst(pathsObject){

	var allResponses ={};
	var newA = {};
	
	var count = 0;
	for ( var path in pathsObject) {

		//== Operation ID is a sub-parameter of the verb
		var verbs = pathsObject[path];
		for( var verb in verbs ) {
			//console.log(" -- "+JSON.stringify(verbs[verb]));
			if( verbs[verb].operationId === flowname) {
				//== May be single "response" or multiple "responses"
				if (verbs[verb].response) {
					return verbs[verb].response;
				}
				if (verbs[verb].responses) {
					allResponses =  verbs[verb].responses;
					for(var resp in allResponses){

						if (resp==="200") {
							newA[resp] = allResponses[resp];
							return newA;
						}
					}
					//== Didn't find a 200, return first one
					for(var resp1 in allResponses){
						newA[resp1] = allResponses[resp1];
						return newA;
					}
				}
			}
		}   
	}       

	//== We may fall through here if the response is not present (even though the OAS spec says must have at least one response)
	//== ( Obviously also if added to proxy PreFlow or PostFlow ! )
	var againverb = context.getVariable('request.verb');
	newA["500"] = {"No_OAS_Definition" : "No matching operationId for Verb='"+againverb+"' and Flowname='"+flowname+"'"};
	return newA;
}



function buildModel (schema, name) {
	
	schema = schema || {};		//== initialise variables the old way
	
    //== base case, and we have an example!
    const example = schema.example;
    if (example) return example;

    switch (schema.type) {
        case 'object':
    		var properties = schema.properties;
    		var obj = {};
    		for (var field in properties ) {
    			obj[field] = buildModel(properties[field], field);
    		}
    		return obj;
    	 
        case 'array':
    		var items = schema.items;
    		return buildModel(items);
      
        default:
          return schema.default || convertSwaggerTypeToExample(schema.type, name);
    }
}


//== Don't use the obvious ... "ServiceCallout.response" .. it is truncated
var geddit = context.getVariable("calloutResponse.content");

if (!geddit) {
    context.setVariable("mockresponse",JSON.stringify({"missing" : "oas.js specification not found in proxy."}));
} else {
    geddit = geddit.replace("var oas = ","");
    geddit = geddit.replace("var oas =","");
    geddit = geddit.replace("var oas=","");
    geddit = geddit.replace("};","}");

    //== Apigee retarded rhinoscript chokes on dodgy JSON
    try {
        oas = JSON.parse(geddit);

            //== Expand all references - decode the whole thing
            const expandedData = expanded(oas);
            //context.setVariable("mockresponse",JSON.stringify(expandedData,null,2));
        
        
            //== Get all paths from the swagger 
            var paths = expandedData.paths;

            var verb = context.getVariable('request.verb');
            var flowname = context.getVariable('current.flow.name');
 
            //== we need to do this ... console.log(JSON.stringify(expandedData.paths["/customer"].get.responses["200"],null,4));	
            var respMsg = response200orFirst(paths);
        
            //== Swagger model definition
            //== Could stop here to reflect swagger only.
            //context.setVariable("mockresponse",JSON.stringify(respMsg,null,2));
         
         
            //== Taking it further - build an example response from the model definition.
			//== Caveat:  Some responses may not have a schema as expected.
			var thisSchema = {};
            for(var resp in respMsg){
            	thisSchema = respMsg[resp].schema;
        	    break;
            }
			if (thisSchema) {
				var model = {};
				if (thisSchema.items) {
					if (thisSchema.items.type == "object") {
						var properties = thisSchema.items.properties;
						for (var field in properties ) {
							model[field] = buildModel(properties[field], field);
						}
					}
				} else {
					//== Not sure if this is valid .. no items declared, straight to properties
					if (thisSchema.properties) {
						var properties = thisSchema.properties;
						for (var field in properties ) {
							model[field] = buildModel(properties[field], field);
						}
					}
				}
				
				context.setVariable("mockresponse",JSON.stringify(model,null,2));
				
			} else {
				//== No schema, reflect what we have in the swagger direct
				context.setVariable("mockresponse",JSON.stringify(respMsg,null,2));
			}

    }
    //== End of the try of the JSON.parse ...
    catch (e) {
        context.setVariable("mockresponse",JSON.stringify({"invalid" : "oas.js specification has invalid construct."}));
        //throw e;
    }

}

